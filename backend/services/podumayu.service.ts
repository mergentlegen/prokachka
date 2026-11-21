import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export type PodumayuOperation = "start" | "answer" | "mark" | "complete";

// «Тренажёр «Я подумаю»»: the database checks each pick, keeps the marks of the last round and gives the mile once.
export async function podumayuAction(userId: string, taskId: string, operation: PodumayuOperation, step = 0, payload: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_podumayu", { p_user_id: userId, p_task_id: taskId, p_action: operation, p_step: step, p_payload: payload });
  if (result.error) return { error: result.error };
  const data = result.data as Record<string, unknown>;
  return typeof data.validationError === "string" ? { validationError: data.validationError } : { data };
}
