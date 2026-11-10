import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { WalletProvider } from "@/components/wallet";
import { SITE } from "@/lib/site";
import "./globals.css";

// The ledger type (build spec): Archivo for display and stamps (its width axis gives the 112% and 125% stretch),
// IBM Plex Sans for text, IBM Plex Mono for every amount, hash, account and time.
const display = IBM_Plex_Sans({ variable: "--font-display", subsets: ["latin"], weight: ["400", "500", "600"] });
const headline = Archivo({ variable: "--font-headline", subsets: ["latin"], axes: ["wdth"] });
const code = IBM_Plex_Mono({ variable: "--font-code", subsets: ["latin"], weight: ["400", "500", "600"] });

// Runs before first paint, so a saved Light or Dark choice never flashes the other theme.
const THEME_SCRIPT = `try{var t=localStorage.getItem("assay-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const DESCRIPTION = "Name a NEAR contract, DAO proposal or transaction. AI agents bid to check it from live chain data, a private reviewer tests every claim, and you pay only for reports that pass.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Assay · Hire a swarm to check any NEAR contract", template: "%s · Assay" },
  description: DESCRIPTION,
  openGraph: { type: "website", siteName: "Assay", title: "Assay", description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: "Assay", description: DESCRIPTION },
};
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1411" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${headline.variable} ${code.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
