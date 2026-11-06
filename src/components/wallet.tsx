"use client";

import { NearProvider, useNearWallet } from "near-connect-hooks";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

type Auth = {
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

/** Decimal NEAR to yoctoNEAR (10^24) as a string, without floating-point error. */
export function toYocto(near: number) {
  const [whole, frac = ""] = near.toFixed(6).split(".");
  return (BigInt(whole) * 10n ** 24n + BigInt(frac.padEnd(24, "0"))).toString();
}

function txHashOf(outcome: unknown): string | null {
  const o = outcome as {
    transaction?: { hash?: string };
    transaction_outcome?: { id?: string };
  } | null;
  return o?.transaction?.hash || o?.transaction_outcome?.id || null;
}

// WalletConnect adds a "scan with any wallet" QR code. Only loaded when a project ID is set.
const WC_PROJECT = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const walletConnect = WC_PROJECT
  ? typeof window === "undefined"
    ? undefined
    : import("@walletconnect/sign-client").then(({ default: SignClient }) =>
        SignClient.init({
          projectId: WC_PROJECT,
          metadata: {
            name: "Swarm-for-Hire",
            description: "AI agents bid for NEAR-paid jobs",
            url: window.location.origin,
            icons: [`${window.location.origin}/icon.svg`],
          },
        }),
      )
  : undefined;

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <NearProvider
      config={{
        network: "testnet",
        providers: {
          testnet: [
            "https://rpc.testnet.fastnear.com",
            "https://test.rpc.fastnear.com",
          ],
        },
        ...(walletConnect ? { walletConnect: walletConnect as never } : {}),
      }}
    >
      <AuthBridge>{children}</AuthBridge>
    </NearProvider>
  );
}

function AuthBridge({ children }: { children: ReactNode }) {
  const wallet = useNearWallet();
  const [account, setAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resolves when the wallet picker has connected an account.
  const waiting = useRef<{
    resolve: (id: string) => void;
    reject: (e: Error) => void;
  } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { accountId: string | null }) => setAccount(d.accountId))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (wallet.signedAccountId && waiting.current) {
      waiting.current.resolve(wallet.signedAccountId);
      waiting.current = null;
    }
  }, [wallet.signedAccountId]);

  const connect = useCallback(async () => {
    if (wallet.signedAccountId) return wallet.signedAccountId;
    const connected = new Promise<string>((resolve, reject) => {
      waiting.current = { resolve, reject };
      setTimeout(() => {
        if (waiting.current) {
          waiting.current.reject(new Error("No wallet was connected."));
          waiting.current = null;
        }
      }, 180_000);
    });
    await wallet.signIn();
    return connected;
  }, [wallet]);

  const prove = useCallback(async () => {
    const ch = (await (
      await fetch("/api/auth/challenge", { cache: "no-store" })
    ).json()) as {
      message: string;
      recipient: string;
      nonce: string;
      token: string;
    };
    const nonce = Uint8Array.from(atob(ch.nonce), (c) => c.charCodeAt(0));
    const signed = await wallet.signNEP413Message({
      message: ch.message,
      recipient: ch.recipient,
      nonce,
    });
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: ch.token,
        accountId: signed.accountId,
        publicKey: String(signed.publicKey),
        signature: String(signed.signature),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Sign-in failed.");
    setAccount(data.accountId);
    return data.accountId as string;
  }, [wallet]);

  const ensure = useCallback(
    async (onStep?: (s: PayStep) => void) => {
      onStep?.("connect");
      const walletAccount = await connect();
      if (account && account === walletAccount) return account;
      onStep?.("sign-in");
      return prove();
    },
    [account, connect, prove],
  );

  const signIn = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      return await ensure();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-in was cancelled.";
      setError(msg);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [ensure]);

  const pay = useCallback(
    async (near: number, to: string, onStep?: (s: PayStep) => void) => {
      await ensure(onStep);
      onStep?.("approve");
      const outcome = await wallet.transfer({
        receiverId: to,
        amount: toYocto(near),
      });
      const hash = txHashOf(outcome);
      if (!hash)
        throw new Error(
          "The wallet didn't return a transaction. Check your wallet's activity before trying again.",
        );
      onStep?.("confirm");
      return hash;
    },
    [ensure, wallet],
  );

  const callWithDeposit = useCallback(
    async (
      contractId: string,
      method: string,
      args: Record<string, unknown>,
      near: number,
      onStep?: (s: PayStep) => void,
    ) => {
      onStep?.("approve");
      const outcome = await wallet.callFunctionRaw({
        contractId,
        method,
        args,
        deposit: toYocto(near),
        gas: "50000000000000",
      });
      const hash = txHashOf(outcome);
      if (!hash)
        throw new Error(
          "The wallet didn't return a transaction. Check your wallet's activity before trying again.",
        );
      onStep?.("confirm");
      return hash;
    },
    [wallet],
  );

  const signOut = useCallback(async () => {
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => {});
    await wallet.signOut().catch(() => {});
    setAccount(null);
  }, [wallet]);

  return (
    <AuthContext.Provider
      value={{
        account,
        ready,
        busy,
        error,
        signIn,
        signOut,
        pay,
        ensureSignedIn: ensure,
        callWithDeposit,
      }}
    >
      {children}
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
          className="btn btn-ghost !px-3 !py-1.5 text-xs"
          onClick={() => signIn().catch(() => {})}
          disabled={busy}
        >
          {busy ? "Check your wallet…" : "Connect wallet"}
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
