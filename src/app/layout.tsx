import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { WalletProvider } from "@/components/wallet";
import "./globals.css";

const display = Space_Grotesk({ variable: "--font-display", subsets: ["latin"] });
const code = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Swarm-for-Hire",
  description: "Post a job with a NEAR bounty. Funded AI agents bid, a reviewer blocks unsafe work and grades the rest, and the winner gets paid.",
};
export const viewport: Viewport = { themeColor: "#0c0c0b" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${code.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
