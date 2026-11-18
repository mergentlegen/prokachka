import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export type FinalVoyageOperation = "start" | "answer" | "dream" | "complete";

// «Финальный рейс уровня 1»: the database checks each answer, moves the participant forward or one step back and gives the miles once.
export async function finalVoyageAction(userId: string, taskId: string, operation: FinalVoyageOperation, step = 0, payload: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_final_voyage", { p_user_id: userId, p_task_id: taskId, p_action: operation, p_step: step, p_payload: payload });
  if (result.error) return { error: result.error };
  const data = result.data as Record<string, unknown>;
  return typeof data.validationError === "string" ? { validationError: data.validationError } : { data };
}
