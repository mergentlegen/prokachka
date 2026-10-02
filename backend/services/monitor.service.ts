import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export type MonitorSnapshot = { dbMs: number; queue: { waiting: number; oldestMinutes: number; failing: number } };

const FAILING_ATTEMPTS = 5;

/**
 * What the server monitor needs to know: is the database answering, and is the Telegram queue moving.
 * Only jobs that can actually be sent count as waiting: a recipient without Telegram is never claimed.
 * The wait is measured from `available_at`, not creation: a job retried for a person who blocked the bot
 * is old but healthy, while a fresh job nobody picks up for 15 minutes means the worker stopped.
 */
export async function monitorSnapshot(now = Date.now()) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const started = Date.now();
  const open = () => supabase.from("telegram_notification_jobs").select("available_at,users!inner(telegram_id)", { count: "exact" })
    .is("delivered_at", null).is("cancelled_at", null).not("users.telegram_id", "is", null);
  const [waiting, failing] = await Promise.all([
    open().lte("available_at", new Date(now).toISOString()).order("available_at", { ascending: true }).limit(1),
    open().gte("attempts", FAILING_ATTEMPTS).limit(1),
  ]);
  if (waiting.error || failing.error) return { error: waiting.error || failing.error };
  const oldest = waiting.data?.[0]?.available_at ? Date.parse(String(waiting.data[0].available_at)) : now;
  return { data: {
    dbMs: Date.now() - started,
    queue: { waiting: waiting.count || 0, oldestMinutes: Math.max(0, Math.floor((now - oldest) / 60_000)), failing: failing.count || 0 },
  } satisfies MonitorSnapshot };
}
