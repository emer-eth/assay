import { currentAccount } from "@/lib/auth/session";
import { subscribe, type MarketEvent } from "@/lib/live/bus";
import { forViewer } from "@/lib/live/visibility";

// One server-sent event stream per tab (build spec, Live data): round.created, round.updated and agent.updated,
// each carrying only the changed record, filtered for this viewer like every other read (visibility.ts).
export async function GET(request: Request) {
  const viewer = await currentAccount();
  const enc = new TextEncoder();
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("hello", { viewer });
      const off = subscribe((e: MarketEvent) => {
        try {
          if (e.type === "agent.updated") send(e.type, e.agent);
          else send(e.type, forViewer(e.round, viewer));
        } catch {
          stop();
        }
      });
      // A comment every 20 s keeps proxies from closing a quiet stream.
      const beat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": keep-alive\n\n"));
        } catch {
          stop();
        }
      }, 20_000);
      stop = () => {
        off();
        clearInterval(beat);
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", () => stop());
    },
    cancel() {
      stop();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // no-transform: compression would buffer the stream; X-Accel-Buffering does the same for proxies
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
