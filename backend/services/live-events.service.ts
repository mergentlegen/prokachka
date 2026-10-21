import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { isChangeTopic, type DatabaseChange } from "@/shared/domain/live-updates";

type Listener = { change: (change: DatabaseChange) => void; status: (ready: boolean) => void };

/**
 * Live streams never end by themselves, and on a restart Next.js waits for every open connection:
 * the old server hung for 30 seconds until systemd killed it. On SIGTERM they all close at once;
 * browsers reconnect to the new server by themselves.
 */
const openStreams = new Set<() => void>();
let stopHooked = false;
/** How long anything else may still hold the stopping server. */
export const STOP_GRACE_MS = 10_000;

export function trackLiveStream(close: () => void) {
  openStreams.add(close);
  if (!stopHooked && typeof process !== "undefined" && typeof process.once === "function") {
    stopHooked = true;
    process.once("SIGTERM", () => {
      closeLiveStreams();
      setTimeout(() => process.exit(143), STOP_GRACE_MS).unref();
    });
  }
  return () => { openStreams.delete(close); };
}

export function closeLiveStreams() {
  const streams = [...openStreams];
  openStreams.clear();
  for (const close of streams) {
    try { close(); } catch { /* The client may already be gone. */ }
  }
  return streams.length;
}
class LiveEventHub {
  private listeners = new Set<Listener>();
  private client: ReturnType<typeof getSupabaseAdmin> = null;
  private channel: ReturnType<NonNullable<ReturnType<typeof getSupabaseAdmin>>["channel"]> | null = null;
  private ready = false;
  private shutdown?: ReturnType<typeof setTimeout>;
  subscribe(listener: Listener) {
    clearTimeout(this.shutdown);
    this.listeners.add(listener);
    if (!this.channel) {
      try { this.start(); }
      catch { this.ready = false; this.channel = null; this.client?.realtime.disconnect(); this.client = null; }
    }
    listener.status(this.ready);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.shutdown = setTimeout(() => {
        const client = this.client, channel = this.channel;
        this.client = null; this.channel = null; this.ready = false;
        if (client && channel) void client.removeChannel(channel).catch(() => undefined).finally(() => client.realtime.disconnect());
      }, 10_000);
    };
  }
  private start() {
    this.client = getSupabaseAdmin();
    if (!this.client) return;
    const channel = this.client.channel("prokachka:changes", { config: { private: true } });
    this.channel = channel;
    channel.on("broadcast", { event: "changed" }, ({ payload }: { payload: unknown }) => {
      if (this.channel !== channel || !payload || typeof payload !== "object") return;
      const row = payload as Record<string, unknown>;
      const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      const change: DatabaseChange = { topics: Array.isArray(row.topics) ? row.topics.filter(isChangeTopic) : [], teamIds: strings(row.teamIds), userIds: strings(row.userIds), catalog: row.catalog === true };
      for (const listener of this.listeners) listener.change(change);
    }).subscribe((status) => {
      if (this.channel !== channel) return;
      const ready = status === "SUBSCRIBED";
      if (ready === this.ready) return;
      this.ready = ready;
      for (const listener of this.listeners) listener.status(this.ready);
    });
  }
}
// One upstream websocket per Node process, not one per browser. Survives dev HMR.
const globalHub = globalThis as typeof globalThis & { prokachkaLiveHub?: LiveEventHub };
export const liveEvents = globalHub.prokachkaLiveHub ??= new LiveEventHub();
