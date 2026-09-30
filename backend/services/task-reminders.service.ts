import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

/** Remembers that a participant opened a task link, so the delivery worker can remind them an hour later. */
export async function recordTaskLinkOpen(userId: string, taskId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_record_task_link_open", { p_user: userId, p_task: taskId });
  return result.error ? { error: result.error } : { data: Boolean(result.data) };
}
