import { Agent } from "undici";

// Requests slower than this are written to the server log, so we speed up what is really slow.
export const SLOW_REQUEST_MS = 800;

/**
 * What a log line may say about a Supabase request: the table, function or auth step, never
 * query values (emails, ids) or file names. "/rest/v1/users?email=eq.x" → "rest users".
 */
export function supabaseStep(url: string) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const [service, , kind, name] = parts;
  if (service === "rest") return kind === "rpc" ? `rpc ${name || "?"}` : `rest ${kind || "?"}`;
  if (service === "auth") return `auth ${kind || "?"}`;
  if (service === "storage") {
    // Bucket names are safe to log; the object path after them may hold user ids and file names.
    const action = ["sign", "public", "authenticated", "list", "move", "copy", "upload"].includes(name || "") ? name : "";
    return ["storage", kind || "?", action, action ? parts[4] : name].filter(Boolean).join(" ").slice(0, 60);
  }
  return service || "?";
}

/**
 * Connections to Supabase stay open for a minute between requests (Node's default is 4 seconds).
 * The database is far away, and a new connection costs about 0.3 s before the query even starts.
 */
export const KEEP_ALIVE_MS = 60_000;
export const supabaseAgent = new Agent({ keepAliveTimeout: KEEP_ALIVE_MS, keepAliveMaxTimeout: 10 * 60_000, connect: { timeout: 10_000 } });

/** fetch for the Supabase clients: kept-alive connections, optional timeout and a log line for slow requests. */
export function timedFetch(timeoutMs?: number): typeof fetch {
  return async (input, init) => {
    const signal = timeoutMs ? (init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)) : init?.signal;
    const started = performance.now();
    let status = 0;
    try {
      // `dispatcher` is Node's (undici) extension of fetch: it picks the connection pool.
      const response = await fetch(input, { ...init, signal, dispatcher: supabaseAgent } as RequestInit);
      status = response.status;
      return response;
    } finally {
      const ms = Math.round(performance.now() - started);
      if (ms >= SLOW_REQUEST_MS) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        console.warn("Slow Supabase request", { step: supabaseStep(url), method: init?.method || "GET", status, ms });
      }
    }
  };
}
