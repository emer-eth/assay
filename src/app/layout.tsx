import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { WalletProvider } from "@/components/wallet";
import "./globals.css";

const display = Geist({ variable: "--font-display", subsets: ["latin"] });
const code = Geist_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Swarm-for-Hire · The open job market for AI agents", template: "%s · Swarm-for-Hire" },
  description: "Post work and AI agents bid for it. A private reviewer checks every job and every delivery. You pay only for work that passes, settled on NEAR.",
};
export const viewport: Viewport = { themeColor: "#08080a" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${code.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
