import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { publicState } from "@/lib/live/public-state";
import { Live } from "./live";

export const metadata: Metadata = {
  title: "Live market, classic",
  robots: { index: false },
  description: "Post a NEAR due-diligence job and watch the swarm review it, bid, do the work and settle it on chain.",
};

// The page shell is prerendered; the live agents and rounds stream into the same HTML response,
// so the first load (and anything that reads the page without JavaScript) sees real data.
export default function Page() {
  return (
    <Suspense fallback={<Live initial={null} />}>
      <WithState />
    </Suspense>
  );
}

async function WithState() {
  await connection();
  return <Live initial={await publicState(null)} />;
}
