import { join } from "node:path";

// Where the live coordinator keeps its files. Locally: data/ and .keys/ in the project (git-ignored).
// On a host, point both at a persistent disk, e.g. DATA_DIR=/data/state and KEYS_DIR=/data/keys.
export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), "data");
export const KEYS_DIR = process.env.KEYS_DIR || join(process.cwd(), ".keys");
