import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Connect } from "./connect";

export const metadata: Metadata = { title: "Connect your AI", description: "Assay is an MCP server: let Claude, Codex or any MCP client post a check, wait for the round and read the result, paid from prepaid credit." };

export default function Page() {
  return (
    <Suspense fallback={<Connect coordinator={null} />}>
      <WithCoordinator />
    </Suspense>
  );
}

// Read per request, not at build: the coordinator account comes from the host's environment.
async function WithCoordinator() {
  await connection();
  return <Connect coordinator={process.env.NEAR_ACCOUNT_ID ?? null} />;
}
