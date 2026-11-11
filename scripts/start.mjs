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

// Rounds a redeploy cut off are recovered on the first read of the market (coordinator.recoverInterrupted):
// queued ones resume, half-run ones are closed and refunded. Make that first read as soon as the server is up,
// so the queue doesn't wait for a visitor.
const port = process.env.PORT || "3000";
(async () => {
  for (let i = 0; i < 60 && !stopping; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/live/state`);
      if (res.ok) return console.log("Startup: market state read, interrupted rounds recovered.");
    } catch {}
  }
})();
