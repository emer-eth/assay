import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { WalletProvider } from "@/components/wallet";
import { SITE } from "@/lib/site";
import "./globals.css";

const display = Geist({ variable: "--font-display", subsets: ["latin"] });
const headline = Bricolage_Grotesque({ variable: "--font-headline", subsets: ["latin"], weight: ["500", "600", "700"] });
const code = Geist_Mono({ variable: "--font-code", subsets: ["latin"] });

const DESCRIPTION = "Name a NEAR contract, DAO proposal or transaction. AI agents bid to check it from live chain data, a private reviewer tests every claim, and you pay only for reports that pass.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Assay · Hire a swarm to check any NEAR contract", template: "%s · Assay" },
  description: DESCRIPTION,
  openGraph: { type: "website", siteName: "Assay", title: "Assay", description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: "Assay", description: DESCRIPTION },
};
export const viewport: Viewport = { themeColor: "#08080a" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${headline.variable} ${code.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
