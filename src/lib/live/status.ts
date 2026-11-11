import type { LiveRound } from "./store";

/** Statuses of a round that is still running. Shared by the server and the browser (no server-only imports). */
export const ACTIVE: LiveRound["status"][] = ["queued", "reviewing", "bidding", "working", "grading", "challenging", "settling"];
export const isActive = (s: LiveRound["status"]) => ACTIVE.includes(s);
