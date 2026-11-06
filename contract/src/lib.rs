//! Swarm-for-Hire escrow.
//!
//! Posters deposit a job's budget into this contract. From then on:
//! - the coordinator can only `settle` (pay a *registered* agent at most the budget, minus a capped fee,
//!   with the rest refunded to the poster in the same call) or `refund` the whole budget;
//! - if the coordinator stalls or disappears, the poster can `reclaim` the whole budget after a timeout.
//!
//! So the coordinator never holds anyone's money, and can never pay out more than a job's budget or to
//! anyone but a registered agent. Every state change is logged as a NEP-297 event for auditing.

use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

/// Smallest budget accepted. Also covers the storage each job record uses.
pub const MIN_BUDGET: NearToken = NearToken::from_millinear(50);
/// The fee can never exceed this share of what the agent is paid (in basis points).
pub const MAX_FEE_BPS: u128 = 500; // 5%
const MAX_JOB_ID_LEN: usize = 64;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    /// Budget is held by the contract.
    Open,
    /// Paid out: agent, fee, and the remainder back to the poster.
    Settled,
    /// Coordinator returned the whole budget.
    Refunded,
    /// Poster took the whole budget back after the timeout.
    Reclaimed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Job {
    pub poster: AccountId,
    pub budget: NearToken,
    /// Block timestamp (nanoseconds) when the budget was deposited.
    pub created_at: u64,
    pub status: Status,
    pub winner: Option<AccountId>,
    pub paid_to_agent: NearToken,
    pub fee: NearToken,
    pub refunded: NearToken,
}

#[near(serializers = [json])]
pub struct Config {
    pub coordinator: AccountId,
    pub fee_account: AccountId,
    pub reclaim_after_ns: u64,
    pub max_fee_bps: u16,
    pub min_budget: NearToken,
    pub open_jobs: u64,
    pub held: NearToken,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Escrow {
    coordinator: AccountId,
    fee_account: AccountId,
    reclaim_after_ns: u64,
    jobs: LookupMap<String, Job>,
    agents: IterableSet<AccountId>,
    open_jobs: u64,
    /// Total budget currently held for open jobs.
    held: NearToken,
}

fn event(kind: &str, data: String) {
    env::log_str(&format!(r#"EVENT_JSON:{{"standard":"swarm-escrow","version":"1.0.0","event":"{kind}","data":[{data}]}}"#));
}

#[near]
impl Escrow {
    #[init]
    pub fn new(coordinator: AccountId, fee_account: AccountId, reclaim_after_minutes: u64) -> Self {
        require!(reclaim_after_minutes >= 1, "reclaim_after_minutes must be at least 1");
        Self {
            coordinator,
            fee_account,
            reclaim_after_ns: reclaim_after_minutes * 60 * 1_000_000_000,
            jobs: LookupMap::new(b"j"),
            agents: IterableSet::new(b"a"),
            open_jobs: 0,
            held: NearToken::from_yoctonear(0),
        }
    }

    // ---------- poster ----------

    /// Deposit a job's budget. `job_id` is chosen by the app and can only be used once.
    #[payable]
    pub fn post_job(&mut self, job_id: String) -> Job {
        let budget = env::attached_deposit();
        require!(budget >= MIN_BUDGET, "Budget must be at least 0.05 NEAR");
        require!(!job_id.is_empty() && job_id.len() <= MAX_JOB_ID_LEN, "job_id must be 1-64 characters");
        require!(!self.jobs.contains_key(&job_id), "job_id already used");
        let poster = env::predecessor_account_id();
        let job = Job {
            poster: poster.clone(),
            budget,
            created_at: env::block_timestamp(),
            status: Status::Open,
            winner: None,
            paid_to_agent: NearToken::from_yoctonear(0),
            fee: NearToken::from_yoctonear(0),
            refunded: NearToken::from_yoctonear(0),
        };
        self.jobs.insert(job_id.clone(), job.clone());
        self.open_jobs += 1;
        self.held = self.held.saturating_add(budget);
        event("job_posted", format!(r#"{{"job_id":"{job_id}","poster":"{poster}","budget":"{}"}}"#, budget.as_yoctonear()));
        job
    }

    /// The safety valve: if a job is still open after the timeout, its poster takes the whole budget back.
    pub fn reclaim(&mut self, job_id: String) -> Promise {
        let mut job = self.open_job(&job_id);
        require!(env::predecessor_account_id() == job.poster, "Only the poster can reclaim");
        require!(env::block_timestamp() >= job.created_at + self.reclaim_after_ns, "Too early to reclaim: the coordinator still has time to settle");
        let amount = job.budget;
        job.status = Status::Reclaimed;
        job.refunded = amount;
        self.close(&job_id, job.clone());
        event("job_reclaimed", format!(r#"{{"job_id":"{job_id}","poster":"{}","amount":"{}"}}"#, job.poster, amount.as_yoctonear()));
        Promise::new(job.poster).transfer(amount)
    }

    // ---------- coordinator ----------

    /// Pays the winning agent `pay`, the fee account `fee`, and refunds the rest of the budget to the poster.
    /// The agent must be registered, `pay + fee` can't exceed the budget, and the fee is capped at 5% of `pay`.
    pub fn settle(&mut self, job_id: String, winner: AccountId, pay: NearToken, fee: NearToken) {
        self.only_coordinator();
        require!(self.agents.contains(&winner), "Winner is not a registered agent");
        let mut job = self.open_job(&job_id);
        let total = pay.checked_add(fee).unwrap_or_else(|| env::panic_str("Amount overflow"));
        require!(total <= job.budget, "Pay plus fee exceeds the job's budget");
        require!(fee.as_yoctonear() * 10_000 <= pay.as_yoctonear() * MAX_FEE_BPS, "Fee is above the 5% cap");
        let refund = job.budget.saturating_sub(total);

        // State first, then transfers (no re-entry possible, and a settled job can't be settled again).
        job.status = Status::Settled;
        job.winner = Some(winner.clone());
        job.paid_to_agent = pay;
        job.fee = fee;
        job.refunded = refund;
        self.close(&job_id, job.clone());
        event(
            "job_settled",
            format!(
                r#"{{"job_id":"{job_id}","winner":"{winner}","pay":"{}","fee":"{}","refund":"{}","poster":"{}"}}"#,
                pay.as_yoctonear(),
                fee.as_yoctonear(),
                refund.as_yoctonear(),
                job.poster
            ),
        );
        if !pay.is_zero() {
            Promise::new(winner).transfer(pay).detach();
        }
        if !fee.is_zero() {
            Promise::new(self.fee_account.clone()).transfer(fee).detach();
        }
        if !refund.is_zero() {
            Promise::new(job.poster).transfer(refund).detach();
        }
    }

    /// Returns the whole budget to the poster (job blocked, no bids, or the work failed review).
    pub fn refund(&mut self, job_id: String) -> Promise {
        self.only_coordinator();
        let mut job = self.open_job(&job_id);
        let amount = job.budget;
        job.status = Status::Refunded;
        job.refunded = amount;
        self.close(&job_id, job.clone());
        event("job_refunded", format!(r#"{{"job_id":"{job_id}","poster":"{}","amount":"{}"}}"#, job.poster, amount.as_yoctonear()));
        Promise::new(job.poster).transfer(amount)
    }

    pub fn register_agent(&mut self, agent: AccountId) {
        self.only_coordinator();
        if self.agents.insert(agent.clone()) {
            event("agent_registered", format!(r#"{{"agent":"{agent}"}}"#));
        }
    }

    pub fn unregister_agent(&mut self, agent: AccountId) {
        self.only_coordinator();
        if self.agents.remove(&agent) {
            event("agent_unregistered", format!(r#"{{"agent":"{agent}"}}"#));
        }
    }

    // ---------- views ----------

    pub fn get_job(&self, job_id: String) -> Option<Job> {
        self.jobs.get(&job_id).cloned()
    }

    pub fn is_agent(&self, account: AccountId) -> bool {
        self.agents.contains(&account)
    }

    pub fn get_agents(&self) -> Vec<AccountId> {
        self.agents.iter().cloned().collect()
    }

    pub fn get_config(&self) -> Config {
        Config {
            coordinator: self.coordinator.clone(),
            fee_account: self.fee_account.clone(),
            reclaim_after_ns: self.reclaim_after_ns,
            max_fee_bps: MAX_FEE_BPS as u16,
            min_budget: MIN_BUDGET,
            open_jobs: self.open_jobs,
            held: self.held,
        }
    }

    // ---------- internal ----------

    fn only_coordinator(&self) {
        require!(env::predecessor_account_id() == self.coordinator, "Only the coordinator can do this");
    }

    fn open_job(&self, job_id: &String) -> Job {
        let job = self.jobs.get(job_id).cloned().unwrap_or_else(|| env::panic_str("No such job"));
        require!(job.status == Status::Open, "Job is already closed");
        job
    }

    fn close(&mut self, job_id: &String, job: Job) {
        self.held = self.held.saturating_sub(job.budget);
        self.open_jobs = self.open_jobs.saturating_sub(1);
        self.jobs.insert(job_id.clone(), job);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    const N: u128 = 1_000_000_000_000_000_000_000_000; // 1 NEAR in yocto
    fn near(milli: u128) -> NearToken {
        NearToken::from_yoctonear(milli * N / 1000)
    }
    fn acct(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(predecessor: &str, deposit: NearToken, minutes: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acct("escrow.testnet"))
            .predecessor_account_id(acct(predecessor))
            .attached_deposit(deposit)
            .block_timestamp(minutes * 60 * 1_000_000_000);
        testing_env!(b.build());
    }
    fn setup() -> Escrow {
        ctx("coord.testnet", NearToken::from_yoctonear(0), 0);
        let mut c = Escrow::new(acct("coord.testnet"), acct("fees.testnet"), 60);
        c.register_agent(acct("agent-1.coord.testnet"));
        c
    }
    fn post(c: &mut Escrow, id: &str, milli: u128, at_min: u64) {
        ctx("alice.testnet", near(milli), at_min);
        c.post_job(id.to_string());
    }

    #[test]
    fn post_holds_the_budget_and_logs_an_event() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        let j = c.get_job("j1".into()).unwrap();
        assert_eq!(j.poster, acct("alice.testnet"));
        assert_eq!(j.budget, near(300));
        assert_eq!(j.status, Status::Open);
        assert_eq!(c.get_config().held, near(300));
        assert!(get_logs().iter().any(|l| l.contains("\"event\":\"job_posted\"")));
    }

    #[test]
    #[should_panic(expected = "Budget must be at least 0.05 NEAR")]
    fn tiny_budgets_are_refused() {
        let mut c = setup();
        post(&mut c, "j1", 10, 0);
    }

    #[test]
    #[should_panic(expected = "job_id already used")]
    fn a_job_id_works_once() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        post(&mut c, "j1", 300, 0);
    }

    #[test]
    fn settle_pays_agent_and_fee_and_refunds_the_rest() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        ctx("coord.testnet", NearToken::from_yoctonear(0), 1);
        c.settle("j1".into(), acct("agent-1.coord.testnet"), near(147), near(3));
        let j = c.get_job("j1".into()).unwrap();
        assert_eq!(j.status, Status::Settled);
        assert_eq!(j.paid_to_agent, near(147));
        assert_eq!(j.fee, near(3));
        assert_eq!(j.refunded, near(150));
        assert_eq!(c.get_config().held, near(0));
        assert_eq!(c.get_config().open_jobs, 0);
    }

    #[test]
    #[should_panic(expected = "Only the coordinator can do this")]
    fn only_the_coordinator_settles() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        ctx("mallory.testnet", NearToken::from_yoctonear(0), 1);
        c.settle("j1".into(), acct("agent-1.coord.testnet"), near(100), near(2));
    }

    #[test]
    #[should_panic(expected = "Winner is not a registered agent")]
    fn the_coordinator_cannot_pay_itself() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        ctx("coord.testnet", NearToken::from_yoctonear(0), 1);
        c.settle("j1".into(), acct("coord.testnet"), near(290), near(5));
    }

    #[test]
    #[should_panic(expected = "Pay plus fee exceeds the job's budget")]
    fn payouts_cannot_exceed_the_budget() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        ctx("coord.testnet", NearToken::from_yoctonear(0), 1);
        c.settle("j1".into(), acct("agent-1.coord.testnet"), near(299), near(5));
    }

    #[test]
    #[should_panic(expected = "Fee is above the 5% cap")]
    fn the_fee_is_capped() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        ctx("coord.testnet", NearToken::from_yoctonear(0), 1);
        c.settle("j1".into(), acct("agent-1.coord.testnet"), near(100), near(10));
    }

    #[test]
    #[should_panic(expected = "Job is already closed")]
    fn a_job_settles_once() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        ctx("coord.testnet", NearToken::from_yoctonear(0), 1);
        c.settle("j1".into(), acct("agent-1.coord.testnet"), near(100), near(2));
        let _ = c.refund("j1".into());
    }

    #[test]
    fn refund_returns_everything() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        ctx("coord.testnet", NearToken::from_yoctonear(0), 1);
        let _ = c.refund("j1".into());
        let j = c.get_job("j1".into()).unwrap();
        assert_eq!(j.status, Status::Refunded);
        assert_eq!(j.refunded, near(300));
        assert_eq!(c.get_config().held, near(0));
    }

    #[test]
    #[should_panic(expected = "Too early to reclaim")]
    fn reclaim_waits_for_the_timeout() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        ctx("alice.testnet", NearToken::from_yoctonear(0), 59);
        let _ = c.reclaim("j1".into());
    }

    #[test]
    fn the_poster_can_reclaim_after_the_timeout() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        ctx("alice.testnet", NearToken::from_yoctonear(0), 60);
        let _ = c.reclaim("j1".into());
        let j = c.get_job("j1".into()).unwrap();
        assert_eq!(j.status, Status::Reclaimed);
        assert_eq!(j.refunded, near(300));
    }

    #[test]
    #[should_panic(expected = "Only the poster can reclaim")]
    fn nobody_else_can_reclaim() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        ctx("mallory.testnet", NearToken::from_yoctonear(0), 120);
        let _ = c.reclaim("j1".into());
    }

    #[test]
    #[should_panic(expected = "Job is already closed")]
    fn a_settled_job_cannot_be_reclaimed() {
        let mut c = setup();
        post(&mut c, "j1", 300, 0);
        ctx("coord.testnet", NearToken::from_yoctonear(0), 1);
        c.settle("j1".into(), acct("agent-1.coord.testnet"), near(100), near(2));
        ctx("alice.testnet", NearToken::from_yoctonear(0), 120);
        let _ = c.reclaim("j1".into());
    }

    #[test]
    #[should_panic(expected = "Only the coordinator can do this")]
    fn only_the_coordinator_registers_agents() {
        let mut c = setup();
        ctx("mallory.testnet", NearToken::from_yoctonear(0), 0);
        c.register_agent(acct("mallory.testnet"));
    }
}
