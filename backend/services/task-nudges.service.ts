import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export type TaskNudgeState = { reachable: number; unreachable: number; queued: number; lastSentAt: string | null; nextAllowedAt: string | null };

/** Previews (send = false) or queues the "you have not sent this task yet" Telegram reminder. */
export async function taskNudge(actorId: string, taskId: string, send: boolean) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_task_nudge", { p_actor: actorId, p_task: taskId, p_send: send });
  if (result.error) return { error: result.error };
  const payload = (result.data || {}) as { forbidden?: boolean; validationError?: string; data?: TaskNudgeState };
  if (payload.forbidden) return { forbidden: true as const };
  if (payload.validationError) return { validationError: payload.validationError };
  if (!payload.data) return { error: new Error("Empty nudge response") };
  return { data: payload.data };
}
