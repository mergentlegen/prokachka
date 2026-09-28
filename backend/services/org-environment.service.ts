import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export type OrgAction = "start" | "finish";

export async function orgEnvironmentAction(userId: string, taskId: string, action: OrgAction, payload?: unknown) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = action === "start"
    ? await supabase.rpc("app_org_batch_start", { p_user_id: userId, p_task_id: taskId })
    : await supabase.rpc("app_org_batch_submit", { p_user_id: userId, p_task_id: taskId, p_payload: payload });
  if (result.error) return { error: result.error };
  const data = result.data as Record<string, unknown>;
  return typeof data.validationError === "string" ? { validationError: data.validationError } : { data };
}
