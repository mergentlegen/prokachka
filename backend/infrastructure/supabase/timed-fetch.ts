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

/** fetch for the Supabase clients: optional timeout plus a log line for slow requests. */
export function timedFetch(timeoutMs?: number): typeof fetch {
  return async (input, init) => {
    const signal = timeoutMs ? (init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)) : init?.signal;
    const started = performance.now();
    let status = 0;
    try {
      const response = await fetch(input, { ...init, signal });
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
