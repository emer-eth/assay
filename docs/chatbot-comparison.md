# Why not just ask a chatbot?

Run on 2026-11-12 with `npm run compare` (`scripts/compare-chatbot.ts`). The question:

> Before I deposit: who controls v2.ref-finance.near, can its code be changed, and by whom?

Each model answered it twice: **plainly**, the way a chatbot does, from what it remembers; and **with tools**, the way an Assay agent does, from the evidence its tools read from NEAR mainnet a moment earlier. The same reviewer then graded all six answers against that evidence, with the rule it applies to every report: fail any claim the evidence contradicts or doesn't contain.

| Model | Plain (no tools) | With Assay's tools |
|---|---|---|
| GPT-5.4 mini | failed | **passed** |
| Gemini 3.8 Flash | failed | **passed** |
| Qwen 3.8 27B | failed | **passed** |

## What the tools read

- Read v2.ref-finance.near: locked (no full-access keys), contract with 170 methods, source not published, owner: ref-finance.sputnik-dao.near; guardians: bim.near, doublerose.near; DAO ref-finance: 5-member council

## Why each plain answer was graded as it was

**GPT-5.4 mini, plain:** failed.
- Fails to answer with the on-chain facts: never names the owner ref-finance.sputnik-dao.near, its 5-member council, or the 3-of-5 / 7-day proposal governance that actually controls upgrades.
- Omits the decisive key finding that the account has 0 full-access and 0 function-call keys (locked), so code changes can only go through the contract's own `upgrade` method — instead it speculates about 'admin keys' and 'deploy_contract', which is not among the deployed methods.
- Delivers generic boilerplate and defers the actual check ('If you want, I can help you check...'), rather than answering the pre-deposit question it was given.

**GPT-5.4 mini, with tools:** **passed**.
- Directly answers all three parts: 0 full-access keys/locked account, code changeable only via the contract's own methods (upgrade/migrate), and reported owner DAO ref-finance.sputnik-dao.near with 5-member council, 3-of-5 threshold, 7-day proposals, plus guardians bim.near and doublerose.near.
- All concrete claims match the evidence: code hash GZmkbfVLcN7ErxU9RDxP24YTaKmoVixhM6XyycP15Qvi, 876 KB, created 2021-08-21, 5 signers, batch_update_degen_token_price x14 / swap x11, council member names, and NEP-330 source not published.
- Correctly flags the one real gap — the evidence does not show code-level access checks for privileged methods — as an explicit unknown with concrete verification steps, rather than asserting it.

**Gemini 3.8 Flash, plain:** failed.
- Names the owner as 'ref-finance-board.sputnik-dao.near' (historically), but the evidence shows get_owner() = 'ref-finance.sputnik-dao.near' — wrong answer to the central question of who controls the contract.
- Contradicts the evidence on governance: says threshold is '3-of-5 or 4-of-7 depending on settings' and that there is no timelock, while the evidence gives a fixed 5-member council with 3-of-5 and 7-day proposals.
- Misses the decisive on-chain facts: 0 full-access keys (account locked, so code changes only via the contract's own `upgrade` method, not native DeployContract as described) and the guardian role (bim.near, doublerose.near) that can freeze/whitelist tokens.

**Gemini 3.8 Flash, with tools:** **passed**.
- Directly answers all three questions: control (no keys, owner DAO, guardians), upgradeability (upgrade/migrate exist), and who can change code (3-of-5 council vote).
- All concrete claims match the evidence: 0 full-access/function-call keys, get_owner = ref-finance.sputnik-dao.near, 5-member council with 3-of-5 and 7-day proposals, guardians bim.near/doublerose.near, code hash GZmkbfVLcN7ErxU9RDxP24YTaKmoVixhM6XyycP15Qvi at 876 KB, created 2021-08-21, balance/storage, NEP-330 unpublished, 25 tx from 5 signers, batch_update_degen_token_price ×14 and swap ×11.
- Owner-only nature of privileged methods is explicitly flagged as inferred by name and unverified, so it is not presented as fact; the actionable next steps (monitor DAO proposals, verify bytecode) are usable.

**Qwen 3.8 27B, plain:** failed.
- Does not answer the question with the on-chain facts: it never names the actual controller (owner = ref-finance.sputnik-dao.near, a Sputnik DAO with a 5-member council, 3-of-5 approval, 7-day proposals) or the guardians (bim.near, doublerose.near), all of which were available in the evidence.
- Its key technical claim is wrong for this account: it says code can be changed by whoever holds 'deploy_contract permission', but the evidence shows 0 full-access and 0 function-call keys, so the account is locked and code changes only via the contract's own `upgrade` method gated by the owner DAO.
- Instead of the requested assessment it delivers generic anti-scam boilerplate and a 'do not deposit' warning, ignoring that this is a deployed, long-lived (since 2021-08-21) Ref Finance contract with a DAO owner and no published source — the real caveats (unpublished NEP-330 source, upgradeable via DAO vote) are not stated.

**Qwen 3.8 27B, with tools:** **passed**.
- Directly answers all three questions: control (locked account, owner DAO, guardians), whether code can change (only via upgrade/migrate), and by whom (owner DAO 3-of-5 council).
- All concrete claims match the evidence: 0 full-access/function-call keys, owner ref-finance.sputnik-dao.near, guardians bim.near/doublerose.near, code hash GZmkbfVLcN7ErxU9RDxP24YTaKmoVixhM6XyycP15Qvi at 876 KB, unpublished NEP-330 source, 5-member council with 3-of-5 quorum and 7-day proposals, balance and recent-activity figures.
- Correctly flags that the evidence does not show which callers are permitted to invoke upgrade/set_owner/migrate, marking that as unverified rather than asserting it.

## Caveats

- One question, three models, one run. Plain models are not always wrong, and agents with tools are not always right: on the live ledger about half of graded reports fail.
- The grader holds the plain answers to the same standard as agents: a claim the evidence doesn't show fails, even if it happens to be true. That is the point of the comparison: a plain answer gives you no way to tell which of its claims are checked.

<details><summary>The plain answers, in full</summary>

### GPT-5.4 mini

`v2.ref-finance.near` is a NEAR account that can have its code changed **only by whoever controls that account’s upgrade authority**.

### Short answer
- **Who controls it?** Usually the **account owner / governing multisig or DAO** behind Ref Finance.
- **Can its code be changed?** **Yes**, if the controlling account has the right to call `deploy_contract` / upgrade the code.
- **By whom?** Only by the entity that holds the account’s **full access key** or an **admin / upgrade path** built into the contract.

### Important NEAR detail
On NEAR, the code for a smart contract account is not “immutable” unless:
- the account has no upgrade key left, or
- the contract is designed to be immutable, or
- upgrades are controlled by a DAO/multisig with on-chain governance.

If `v2.ref-finance.near` still has an admin key or DAO-controlled upgrade mechanism, then the code **can be changed**.

### How to verify who controls it
Check:
1. **Account access keys** on NEAR Explorer
2. Whether the account has:
   - a **full access key**, or
   - a **multisig/DAO contract** as the admin
3. The contract source / repo / governance docs for the specific upgrade process

### What to look for
- If the owner is a **DAO contract**, then upgrades happen by **DAO vote**
- If the owner is a **multisig**, then upgrades happen by **signers of that multisig**
- If there’s an **admin function** in the contract, the admin address is the effective controller

### Bottom line
Before depositing, assume **the contract can be changed unless you confirm otherwise on-chain**.  
If you want, I can help you check the current on-chain ownership/keys for `v2.ref-finance.near` step by step.

### Gemini 3.8 Flash

Here is the security and governance breakdown for **`v2.ref-finance.near`** (the main AMM liquidity pool contract for Ref Finance):

---

### 1. Who controls it?
`v2.ref-finance.near` is **not controlled by a single private key**. Instead, ownership and administrative control belong to the **Ref Finance DAO** via a Sputnik DAO multisig contract (historically `ref-finance-board.sputnik-dao.near`). 

* **Governance Mechanism:** Control is handled through a multisig council made up of core team members, ecosystem partners, and community representatives.
* **Execution:** No individual person can perform administrative actions unilaterally. Any action requires a proposal and a threshold of votes (e.g., 3-of-5 or 4-of-7, depending on current council settings) to execute.

---

### 2. Can its code be changed (upgraded)?
**Yes, the contract is fully upgradeable.**

* Unlike Ethereum AMMs like Uniswap v2/v3 (which are deployed to immutable addresses), NEAR’s native account model allows code to be redeployed to the same account ID (`v2.ref-finance.near`) unless all full-access keys are permanently deleted.
* Ref Finance intentionally keeps this contract upgradeable to deploy bug fixes, optimize routing, and introduce new pool types (like rated/stable pools or order-book integrations).

---

### 3. By whom can it be changed?
The contract can only be changed by the **Ref Finance Council via DAO proposal**:

1. A council member or authorized developer submits a `DeployContract` or `upgrade` proposal to the Sputnik DAO contract.
2. The council votes on-chain.
3. Once the required voting threshold is met, the DAO contract calls NEAR’s native deployment mechanics to overwrite the contract's Wasm bytecode with the new version.

---

### Risks to Consider Before Depositing

If you are evaluating the counterparty/smart contract risk:

1. **Multisig Trust Assumption:** You are trusting that the multisig signers will not act maliciously, collude, or have their private keys compromised. If an attacker compromises enough council keys, they could technically deploy malicious code that drains the pools.
2. **No Strict Timelock:** Upgrades do not typically go through an extended, mandatory on-chain timelock (e.g., 7–14 days). Once the multisig threshold is reached, code can be changed immediately.
3. **Historical Track Record:** Ref Finance has operated since 2021 as the primary DEX on NEAR without an internal rug-pull or governance exploit, but the architectural risk of upgradability remains present.

*You can verify the current signers, voting threshold, and recent proposals directly on NEAR explorers like [NEARblocks](https://nearblocks.io/address/v2.ref-finance.near) or the [AstroDAO / SputnikDAO interface](https://app.astrodao.com/).*

### Qwen 3.8 27B

**Critical Warning: Do NOT deposit funds into `v2.ref-finance.near` or any similar unverified contract.**

Here is a detailed breakdown of the risks and technical realities:

### 1. **Who Controls `v2.ref-finance.near`?**
- **The account owner** (the NEAR account that deployed or currently holds the contract) controls the contract.
- On NEAR, **any account can deploy a smart contract** under any name (including names that mimic legitimate projects like "Ref Finance").
- **There is no central authority** that verifies whether `v2.ref-finance.near` is the *official* Ref Finance contract. **You must verify the official contract address directly from Ref Finance’s official website, social media (Twitter/X, Discord), or documentation.**

### 2. **Can Its Code Be Changed?**
- **Yes, in most cases.** NEAR smart contracts are typically written in Rust and compiled to WebAssembly (WASM).
- **If the contract is upgradeable:** The owner can replace the contract code with a new version at any time. This is common in DeFi protocols for bug fixes or feature updates.
- **If the contract is not upgradeable:** The code is immutable, but the owner can still control the *logic* via external parameters or admin functions (e.g., pausing withdrawals, changing fees, or draining funds if the code has vulnerabilities).

### 3. **By Whom Can It Be Changed?**
- **Only the account that has the `deploy_contract` permission** (usually the original deployer or an admin account specified in the contract).
- **This is a single point of failure.** If that account’s private key is compromised, or if the developer is malicious, they can:
  - Replace the contract with a malicious version.
  - Drain all funds from the contract.
  - Freeze user withdrawals.
  - Change fee structures arbitrarily.

### 4. **How to Verify Before Depositing**
1. **Check the Official Source:**
   - Go to **Ref Finance’s official website** (verify the URL carefully; look for HTTPS and official branding).
   - Find the **official contract address** in their documentation or "Contract" section.
   - **Compare it with `v2.ref-finance.near`.** If it doesn’t match, **do not deposit**.

2. **Use NEAR Explorer:**
   - Visit [explorer.near.org](https://explorer.near.org) and search for `v2.ref-finance.near`.
   - Check the **contract owner** and **deployment history**.
   - Look for **recent code changes**. If the code was recently updated, be extra cautious.

3. **Community Verification:**
   - Ask in Ref Finance’s **official Discord or Twitter** if `v2.ref-finance.near` is the correct contract.
   - **Never trust random links or DMs** claiming to be the official contract.

4. **Start Small:**
   - If you are still unsure, deposit a **minimal amount** first to test if withdrawals work as expected.

### 5. **Red Flags**
- **Unfamiliar contract names:** Legitimate projects usually use clear, consistent naming (e.g., `ref-finance.near`, not `v2.ref-finance.near` unless explicitly stated).
- **No official documentation:** If you can’t find the contract address on the project’s official site, it’s likely a scam.
- **Pressure to act quickly:** Scammers often create urgency ("limited time," "high APY").

### **Conclusion**
**Do not deposit funds into `v2.ref-finance.near` until you have verified it is the official Ref Finance contract through their official channels.** The contract owner can potentially change the code or drain funds if they are malicious or compromised. **When in doubt, leave it out.**

</details>
