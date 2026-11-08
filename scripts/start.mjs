// Starts `next start` and treats a stop signal as a clean exit. Railway stops the old container with
// SIGTERM on every redeploy; Next.js then exits by signal, npm reports it as a failure, and Railway
// emails "Deploy Crashed" for a deployment that was simply replaced.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "start", ...process.argv.slice(2)], { stdio: "inherit" });
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    stopping = true;
    child.kill(sig);
  });
}
child.on("exit", (code, signal) => process.exit(stopping ? 0 : (code ?? (signal ? 1 : 0))));
