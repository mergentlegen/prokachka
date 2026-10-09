import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export type SafetyWatchOperation = "start" | "save" | "complete";

// «Вахта безопасности»: the database checks each deck's answers and gives the miles once.
export async function safetyWatchAction(userId: string, taskId: string, operation: SafetyWatchOperation, deck = 0, payload: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_safety_watch", { p_user_id: userId, p_task_id: taskId, p_action: operation, p_deck: deck, p_payload: payload });
  if (result.error) return { error: result.error };
  const data = result.data as Record<string, unknown>;
  return typeof data.validationError === "string" ? { validationError: data.validationError } : { data };
}
