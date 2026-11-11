"use client";

import { TopBar } from "@/ui/chrome";
import { WalletButton } from "./wallet";

/** The top bar on app routes: the shared bar with the wallet button on the right (only app routes load wallet code). */
export function AppHeader() {
  return <TopBar right={<WalletButton />} />;
}
