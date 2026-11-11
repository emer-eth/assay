// Which NEAR network this deployment runs on. One codebase, one deployment per network (two Railway services),
// so testnet can never touch mainnet keys or funds. NEXT_PUBLIC_ so the browser bundle is built for the same
// network as the server. Plain module: safe in server and client code.

export type Network = "mainnet" | "testnet";

export const NETWORK: Network = process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const IS_MAINNET = NETWORK === "mainnet";
export const OTHER_NETWORK: Network = IS_MAINNET ? "testnet" : "mainnet";
/** The other deployment's address, for the network switch (unset: no switch). */
export const OTHER_NETWORK_URL = process.env.NEXT_PUBLIC_OTHER_NETWORK_URL || "";

/** Public RPCs (FastNEAR; rpc.*.near.org is deprecated and rate-limits). NEAR_RPC_URL overrides on the server. */
export const PUBLIC_RPCS: Record<Network, string[]> = {
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com"],
  testnet: ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com"],
};

const EXPLORER = IS_MAINNET ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
export const explorerTx = (hash: string) => `${EXPLORER}/txns/${hash}`;
export const explorerAccount = (id: string) => `${EXPLORER}/address/${id}`;

/** Named accounts end in .near (mainnet) or .testnet; 64-hex implicit accounts exist on both. */
export const isNetworkAccount = (id: string) => (IS_MAINNET ? /\.near$/.test(id) && !id.endsWith(".testnet") : id.endsWith(".testnet")) || /^[0-9a-f]{64}$/.test(id);

/** Where to get an account on this network. */
export const WALLET_SIGNUP = IS_MAINNET ? "https://wallet.meteorwallet.app" : "https://testnet.mynearwallet.com";

/** Limits per network. Mainnet is real money and the escrow is unaudited, so its caps are low (user's choice, 11 Nov). */
export const LIMITS = IS_MAINNET ? { maxAgents: 12, maxFunding: 0.5, maxBudget: 0.5, minFunding: 0.1 } : { maxAgents: 12, maxFunding: 2, maxBudget: 5, minFunding: 0.1 };

/** "NEAR testnet" / "NEAR mainnet", for copy. */
export const NETWORK_LABEL = `NEAR ${NETWORK}`;
