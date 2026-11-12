import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { commitmentText } from "./commit";

export const newSalt = () => randomBytes(16).toString("hex");
export const bidCommitment = (roundId: string, agent: string, ask: number, salt: string) => createHash("sha256").update(commitmentText(roundId, agent, ask, salt)).digest("hex");
