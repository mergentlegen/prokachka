import { getCurrentUser } from "@/backend/http/current-user";
import { getSessionToken, readSession } from "@/backend/services/auth.service";
import { liveEvents } from "@/backend/services/live-events.service";
import { topicsForViewer } from "@/shared/domain/live-updates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return new Response(null, { status: 401 });
  const token = getSessionToken(request);
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let lifetime: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat); clearTimeout(lifetime); unsubscribe();
        request.signal.removeEventListener("abort", finish);
        try { controller.close(); } catch { /* Already cancelled by the client. */ }
      };
      cleanup = finish;
      const send = (frame: string) => {
        if (closed) return;
        // Slow/disconnected consumers must not build an unbounded server queue.
        if ((controller.desiredSize ?? 0) < -8) { finish(); return; }
        controller.enqueue(encoder.encode(frame));
      };
      const event = (name: string, data: unknown) => send(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      unsubscribe = liveEvents.subscribe({
        change(change) {
          const topics = topicsForViewer(change, user);
          if (topics.length) event("change", topics);
          // Reconnect through fresh DB permissions; never reuse a stale team scope.
          if (topics.includes("session")) finish();
        },
        status(ready) { event(ready ? "ready" : "degraded", {}); },
      });
      heartbeat = setInterval(() => {
        if (!readSession(token)) { event("change", ["session"]); finish(); }
        else send(": heartbeat\n\n");
      }, 20_000);
      // Also reauthorize if a database event was lost during an upstream outage.
      lifetime = setTimeout(finish, 5 * 60_000);
      request.signal.addEventListener("abort", finish, { once: true });
      if (request.signal.aborted) finish();
    },
    cancel() { cleanup(); },
  });
  return new Response(body, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "private, no-cache, no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
