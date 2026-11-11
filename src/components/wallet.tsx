"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Wallets, the "pay when you commit" way: anyone can use the page; the wallet only comes in when
// someone posts a job or backs an agent. First time: connect, sign a one-time message (NEP-413,
// no gas) so the server knows who you are, then approve the payment. After that: just the payment.

export type PayStep = "connect" | "sign-in" | "approve" | "confirm";
export const PAY_STEP_LABEL: Record<PayStep, string> = {
  connect: "Choose a wallet…",
  "sign-in": "Approve the sign-in message in your wallet (no gas)…",
  approve: "Approve the payment in your wallet…",
  confirm: "Confirming the payment on chain…",
};

export type Auth = {
  account: string | null;
  ready: boolean;
  busy: boolean;
  error: string | null;
  signIn: () => Promise<string>;
  signOut: () => Promise<void>;
  /** Signs in if needed, then sends `near` to `to` from the user's wallet and returns the transaction hash. */
  pay: (
    near: number,
    to: string,
    onStep?: (s: PayStep) => void,
  ) => Promise<string>;
  /** Signs in if needed (connect + one-time message). Resolves to the verified account. */
  ensureSignedIn: (onStep?: (s: PayStep) => void) => Promise<string>;
  /** Calls a contract method from the user's wallet with NEAR attached; returns the transaction hash. */
  callWithDeposit: (
    contractId: string,
    method: string,
    args: Record<string, unknown>,
    near: number,
    onStep?: (s: PayStep) => void,
  ) => Promise<string>;
};
const AuthContext = createContext<Auth | null>(null);
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <WalletProvider>");
  return ctx;
};

/** Named testnet accounts end in .testnet; 64-hex implicit accounts exist on every network. */
export const isTestnetAccount = (id: string) =>
  id.endsWith(".testnet") || /^[0-9a-f]{64}$/.test(id);

export class WrongNetworkError extends Error {
  constructor(account: string) {
    super(`${account} is a mainnet account. This demo runs on NEAR testnet.`);
  }
}

/** Decimal NEAR to yoctoNEAR (10^24) as a string, without floating-point error. */
export function toYocto(near: number) {
  const [whole, frac = ""] = near.toFixed(6).split(".");
  return (BigInt(whole) * 10n ** 24n + BigInt(frac.padEnd(24, "0"))).toString();
}

// The wallet engine (near-connect and its crypto, about 217 KB gzipped) lives in wallet-engine.tsx and loads on the
// first Connect or Pay, not with the page (build spec, Wallet). Until then this provider knows who is signed in
// from the session cookie, and each action loads the engine first, then runs the engine's own function.

const loadEngine = () => import("./wallet-engine");
const Engine = dynamic(() => loadEngine().then((m) => m.WalletEngine), { ssr: false });

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [want, setWant] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<Auth | null>(null);
  const engineRef = useRef<Auth | null>(null);
  const waiters = useRef<{ resolve: (a: Auth) => void; reject: (e: Error) => void }[]>([]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { accountId: string | null }) => setAccount(d.accountId))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // Warm the engine when someone points at, or tabs to, a wallet action (a pay or connect button).
  useEffect(() => {
    const warm = (e: Event) => {
      if ((e.target as Element | null)?.closest?.("[data-wallet]")) void loadEngine().catch(() => {});
    };
    document.addEventListener("pointerover", warm, { passive: true });
    document.addEventListener("focusin", warm);
    return () => {
      document.removeEventListener("pointerover", warm);
      document.removeEventListener("focusin", warm);
    };
  }, []);

  const onValue = useCallback((v: Auth) => {
    engineRef.current = v;
    setEngine(v);
    waiters.current.splice(0).forEach((w) => w.resolve(v));
  }, []);

  /** The running engine: mounts it on first use and resolves once its connector is ready. */
  const get = useCallback(() => {
    if (engineRef.current) return Promise.resolve(engineRef.current);
    setWant(true);
    setError(null);
    return new Promise<Auth>((resolve, reject) => {
      waiters.current.push({ resolve, reject });
      loadEngine().catch(() => {
        const e = new Error("Couldn't load the wallet. Check your connection and try again.");
        setError(e.message);
        setWant(false);
        waiters.current.splice(0).forEach((w) => w.reject(e));
      });
    });
  }, []);

  const lazy = useMemo<Auth>(
    () => ({
      account,
      ready,
      busy: false,
      error,
      signIn: () => get().then((a) => a.signIn()),
      signOut: async () => {
        await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => {});
        setAccount(null);
      },
      pay: (near, to, onStep) => get().then((a) => a.pay(near, to, onStep)),
      ensureSignedIn: (onStep) => get().then((a) => a.ensureSignedIn(onStep)),
      callWithDeposit: (contractId, method, args, near, onStep) => get().then((a) => a.callWithDeposit(contractId, method, args, near, onStep)),
    }),
    [account, ready, error, get],
  );

  return (
    <AuthContext.Provider value={engine ?? lazy}>
      {children}
      {want && <Engine onValue={onValue} />}
    </AuthContext.Provider>
  );
}

export function WalletButton() {
  const { account, ready, busy, error, signIn, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  if (!ready) return <span className="h-8 w-28" aria-hidden />;
  if (!account)
    return (
      <span className="flex flex-col items-end">
        <button
          data-wallet=""
          className="btn btn-ghost min-h-11 !px-4 !py-1.5 text-sm"
          onClick={() => signIn().catch(() => {})}
          disabled={busy}
        >
          {busy ? "Check your wallet…" : "Connect testnet wallet"}
        </button>
        {error && (
          <span
            role="alert"
            className="mt-1 max-w-56 text-right text-[11px] text-bad"
          >
            {error}
          </span>
        )}
      </span>
    );
  return (
    <span className="relative">
      <button
        className="num flex items-center gap-2 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs hover:bg-panel-2"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="size-1.5 rounded-full bg-ok" />
        <span className="max-w-40 truncate">{account}</span>
      </button>
      {open && (
        <span className="panel enter absolute top-full right-0 z-30 mt-1.5 grid min-w-48 p-1 text-sm">
          <a
            className="rounded-md px-3 py-2 text-muted hover:bg-panel-2 hover:text-text"
            href={`https://testnet.nearblocks.io/address/${account}`}
            target="_blank"
            rel="noreferrer"
          >
            View on explorer ↗
          </a>
          <button
            className="rounded-md px-3 py-2 text-left text-muted hover:bg-panel-2 hover:text-text"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
          >
            Sign out
          </button>
        </span>
      )}
    </span>
  );
}

/** Shown when someone connects a mainnet wallet: what testnet is and how to get a free account in a minute. */
export function TestnetHelp({
  account,
  onClose,
}: {
  account: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tn-h"
      onClick={onClose}
    >
      <div
        className="panel-glow enter w-full max-w-lg p-6 sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="eyebrow">NEAR testnet</p>
        <h2 id="tn-h" className="headline mt-2 text-2xl text-text">
          This demo runs on testnet
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          You connected <span className="num text-text">{account}</span>, a
          mainnet account with real NEAR. Assay uses free test NEAR on
          testnet, so nothing you do here can cost real money. We&apos;ve
          disconnected it.
        </p>
        <ol className="mt-5 grid gap-3 text-[14px]">
          {[
            <>
              Create a free testnet account in{" "}
              <a
                className="text-text underline underline-offset-4"
                href="https://testnet.mynearwallet.com"
                target="_blank"
                rel="noreferrer"
              >
                MyNearWallet (testnet)
              </a>{" "}
              or{" "}
              <a
                className="text-text underline underline-offset-4"
                href="https://wallet.meteorwallet.app"
                target="_blank"
                rel="noreferrer"
              >
                Meteor Wallet
              </a>{" "}
              (switch it to testnet). It ends in{" "}
              <span className="num text-text">.testnet</span>.
            </>,
            <>
              Top it up with free test NEAR from the{" "}
              <a
                className="text-text underline underline-offset-4"
                href="https://near-faucet.io"
                target="_blank"
                rel="noreferrer"
              >
                testnet faucet
              </a>{" "}
              if it starts empty.
            </>,
            <>Come back and connect that testnet account.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="num grid size-6 shrink-0 place-items-center rounded-full border border-line-strong text-xs text-muted">
                {i + 1}
              </span>
              <span className="pt-0.5 text-muted">{step}</span>
            </li>
          ))}
        </ol>
        <div className="mt-7 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={onClose}>
            Got it
          </button>
          <a className="btn btn-ghost" href="/simulation">
            Try the simulation instead
          </a>
        </div>
      </div>
    </div>
  );
}
