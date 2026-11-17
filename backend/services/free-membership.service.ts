import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export type FreeMembershipOperation = "start" | "save" | "complete";

// «Безоплатное членство»: the database checks the missions and the final check and gives the miles once.
export async function freeMembershipAction(userId: string, taskId: string, operation: FreeMembershipOperation, step = 0, payload: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_free_membership", { p_user_id: userId, p_task_id: taskId, p_action: operation, p_step: step, p_payload: payload });
  if (result.error) return { error: result.error };
  const data = result.data as Record<string, unknown>;
  return typeof data.validationError === "string" ? { validationError: data.validationError } : { data };
}
