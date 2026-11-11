// Shared layout values. Kept out of the "use client" files: a server component importing a plain value
// from a client module gets a client reference, not the value (a class name would come through empty).

/** Content is 1200 wide with 32 side padding, 20 on a phone (build spec, Space and shape). */
export const CONTAINER = "mx-auto w-full max-w-[1264px] px-5 sm:px-8";

/** A transaction in the explorer, on this deployment's network. */
export { explorerTx } from "@/lib/network";
