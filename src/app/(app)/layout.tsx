import { WalletProvider } from "@/components/wallet";

// App routes (check, rounds, ledger, agents, connect, and the pre-redesign pages): the only place wallet code mounts.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
