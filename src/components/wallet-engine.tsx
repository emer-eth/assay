"use client";

import { NearProvider, useNearWallet } from "near-connect-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTestnetAccount, TestnetHelp, toYocto, WrongNetworkError, type Auth, type PayStep } from "./wallet";

// The wallet engine, loaded on the first Connect or Pay (see WalletProvider in wallet.tsx). The code below moved
// here unchanged from wallet.tsx; only the bridge's ending differs: it hands its value to the provider instead of
// wrapping the page, so the page never waits for near-connect to load.

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
            name: "Assay",
            description: "AI agents bid for NEAR-paid jobs",
            url: window.location.origin,
            icons: [`${window.location.origin}/icon.svg`],
          },
        }),
      )
  : undefined;

/** The real wallet: near-connect's provider and the bridge, unchanged except that the bridge hands its value up. */
// One config object for the life of the page: a new object on each render could make the connector rebuild.
const NEAR_CONFIG = {
  network: "testnet" as const,
  providers: {
    testnet: [
      "https://rpc.testnet.fastnear.com",
      "https://test.rpc.fastnear.com",
    ],
  },
  ...(walletConnect ? { walletConnect: walletConnect as never } : {}),
};

export function WalletEngine({ onValue }: { onValue: (v: Auth) => void }) {
  return (
    <NearProvider
      config={NEAR_CONFIG}
    >
      <AuthBridge onValue={onValue} />
    </NearProvider>
  );
}

function AuthBridge({ onValue }: { onValue: (v: Auth) => void }) {
  const wallet = useNearWallet();
  const [account, setAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrongNetwork, setWrongNetwork] = useState<string | null>(null); // a mainnet account that tried to connect
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
      if (!isTestnetAccount(walletAccount)) {
        // A mainnet account: disconnect it before asking for any signature, and explain how to get a testnet one.
        await wallet.signOut().catch(() => {});
        setWrongNetwork(walletAccount);
        throw new WrongNetworkError(walletAccount);
      }
      if (account && account === walletAccount) return account;
      onStep?.("sign-in");
      return prove();
    },
    [account, connect, prove, wallet],
  );

  const signIn = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      return await ensure();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-in was cancelled.";
      if (!(e instanceof WrongNetworkError)) setError(msg);
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

  // Hand the value up once the connector has finished loading, and again whenever it changes.
  const value = useMemo<Auth>(
    () => ({ account, ready, busy, error, signIn, signOut, pay, ensureSignedIn: ensure, callWithDeposit }),
    [account, ready, busy, error, signIn, signOut, pay, ensure, callWithDeposit],
  );
  useEffect(() => {
    if (!wallet.loading) onValue(value);
  }, [wallet.loading, value, onValue]);

  return wrongNetwork ? (
    <TestnetHelp
      account={wrongNetwork}
      onClose={() => setWrongNetwork(null)}
    />
  ) : null;
}

