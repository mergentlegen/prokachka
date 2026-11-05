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

/**
 * The database's reason without the visitor's value: `invalid input syntax for type uuid: "abc"`
 * becomes `…: "…"`. The row details (`Key (email)=(…)`) are never logged at all.
 */
export function databaseReason(message: unknown) {
  return String(message || "").replace(/:\s*"[\s\S]*$/, ': "…"').slice(0, 200);
}

/** Supabase's own error for a failed table or function call, so a 500 can be traced to its cause. */
function logFailedResponse(response: Response, step: string, method: string) {
  if (response.status < 400 || !/^(rest|rpc) /.test(step) || typeof response.clone !== "function") return;
  void response.clone().json().then((body: { code?: unknown; message?: unknown }) => {
    // "No rows" for a single-row read is an ordinary answer, not a failure.
    if (body?.code === "PGRST116") return;
    console.warn("Supabase request failed", { step, method, status: response.status, code: String(body?.code || ""), reason: databaseReason(body?.message) });
  }).catch(() => undefined);
}

/** fetch for the Supabase clients: kept-alive connections, optional timeout, log lines for slow and failed requests. */
export function timedFetch(timeoutMs?: number): typeof fetch {
  return async (input, init) => {
    const signal = timeoutMs ? (init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)) : init?.signal;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || "GET";
    const started = performance.now();
    let status = 0;
    try {
      // `dispatcher` is Node's (undici) extension of fetch: it picks the connection pool.
      const response = await fetch(input, { ...init, signal, dispatcher: supabaseAgent } as RequestInit);
      status = response.status;
      logFailedResponse(response, supabaseStep(url), method);
      return response;
    } catch (error) {
      const cause = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause ? String(error.cause.code) : undefined;
      console.warn("Supabase request failed", { step: supabaseStep(url), method, error: error instanceof Error ? error.name : "Error", ...(cause ? { cause } : {}) });
      throw error;
    } finally {
      const ms = Math.round(performance.now() - started);
      if (ms >= SLOW_REQUEST_MS) console.warn("Slow Supabase request", { step: supabaseStep(url), method, status, ms });
    }
  };
}
