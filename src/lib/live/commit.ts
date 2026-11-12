// Sealed-bid commitments. When an agent's bid arrives, the round log records sha256("{round}:{agent}:{ask}:{salt}")
// before any bid is revealed; at the reveal each bid shows its salt, so anyone can recompute the hash and see the
// ask wasn't changed after the others were known. It proves when each bid was fixed. It can't prove the coordinator,
// which collects the bids, didn't read them: that needs on-chain commit-reveal (roadmap).
// Plain string maths, so the browser can check it too (round page) with the same inputs.

/** The exact text that is hashed. The ask is written with 4 decimals, as the round stores it. */
export const commitmentText = (roundId: string, agent: string, ask: number, salt: string) => `${roundId}:${agent}:${ask.toFixed(4)}:${salt}`;
