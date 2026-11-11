"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { PublicState } from "./live/public-state";
import { ACTIVE } from "./live/status";
import type { LiveAgent } from "./live/store";
import type { PublicRound } from "./live/visibility";

// useMarket(): one live view of the market per tab (build spec, Live data). It subscribes once to
// /api/events and folds each change into a single snapshot that every component reads through a selector.
// The stream closes while the tab is hidden and catches up when it's shown again. If the stream can't connect,
// it falls back to a 10 s poll of /api/live/state with an ETag, so an unchanged market costs a 304.

export type MarketState = PublicState;
const KEEP = 30; // rounds held in the snapshot, like the server's

let state: MarketState | null = null;
const listeners = new Set<() => void>();
let es: EventSource | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let etag: string | null = null;
let fetching: Promise<void> | null = null;

function set(next: MarketState) {
  state = { ...next, busy: next.rounds.some((r) => ACTIVE.includes(r.status)) };
  listeners.forEach((l) => l());
}

/** Fetch the full snapshot now (after an action, or to catch up). Concurrent calls share one request. */
export function refetchMarket(): Promise<void> {
  fetching ??= fetch("/api/live/state", { cache: "no-store", headers: etag ? { "if-none-match": etag } : {} })
    .then(async (r) => {
      if (r.status === 304) return;
      if (!r.ok) throw new Error(String(r.status));
      etag = r.headers.get("etag");
      set((await r.json()) as MarketState);
    })
    .finally(() => (fetching = null));
  return fetching;
}

function upsertRound(r: PublicRound, created: boolean) {
  if (!state) return;
  const i = state.rounds.findIndex((x) => x.id === r.id);
  const rounds = i >= 0 ? state.rounds.map((x) => (x.id === r.id ? r : x)) : created ? [r, ...state.rounds].slice(0, KEEP) : state.rounds;
  set({ ...state, rounds });
}
function upsertAgent(a: LiveAgent) {
  if (!state) return;
  const i = state.agents.findIndex((x) => x.id === a.id);
  set({ ...state, agents: i >= 0 ? state.agents.map((x) => (x.id === a.id ? a : x)) : [...state.agents, a] });
}

function startPoll() {
  poll ??= setInterval(() => void refetchMarket().catch(() => {}), 10_000);
}
function stopPoll() {
  if (poll) clearInterval(poll);
  poll = null;
}

function open() {
  if (es || typeof EventSource === "undefined") return startPoll();
  es = new EventSource("/api/events");
  es.addEventListener("hello", () => {
    stopPoll();
    void refetchMarket().catch(() => {}); // anything that changed before the stream opened
  });
  es.addEventListener("round.created", (e) => upsertRound(JSON.parse((e as MessageEvent).data), true));
  es.addEventListener("round.updated", (e) => upsertRound(JSON.parse((e as MessageEvent).data), false));
  es.addEventListener("agent.updated", (e) => upsertAgent(JSON.parse((e as MessageEvent).data)));
  // The browser retries the stream by itself; poll meanwhile so nothing goes stale.
  es.onerror = () => startPoll();
}
function close() {
  es?.close();
  es = null;
  stopPoll();
}
function onVisibility() {
  if (document.hidden) close();
  else open();
}

// A component swap (a loading fallback handing over to the page) drops to zero listeners for an instant:
// wait a second before closing, so it doesn't cost a second stream and another snapshot.
let closing: ReturnType<typeof setTimeout> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (closing) {
    clearTimeout(closing);
    closing = null;
  } else if (listeners.size === 1) {
    if (!document.hidden) open();
    document.addEventListener("visibilitychange", onVisibility);
    if (!state) void refetchMarket().catch(() => {});
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      closing = setTimeout(() => {
        closing = null;
        if (listeners.size) return;
        document.removeEventListener("visibilitychange", onVisibility);
        close();
      }, 1000);
    }
  };
}

/**
 * The live market. Pass the server's snapshot as `initial` so the first paint needs no fetch.
 * Selectors must return stored values (a field, a round), not new objects; derive with useMemo.
 */
export function useMarket<T>(select: (s: MarketState | null) => T, initial?: MarketState | null): T {
  // Until the store holds a snapshot, read the server's. It is seeded in an effect (browser only): on the server
  // this module is shared by every request, and a snapshot can hold a poster's private report.
  useEffect(() => {
    if (initial) seedMarket(initial);
  }, [initial]);
  return useSyncExternalStore(
    subscribe,
    () => select(state ?? initial ?? null),
    () => select(initial ?? null),
  );
}

function seedMarket(initial: MarketState) {
  if (!state) set(initial);
}
