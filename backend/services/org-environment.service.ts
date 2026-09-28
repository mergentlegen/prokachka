import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export type OrgAction = "start" | "begin" | "answer" | "advance" | "finish";

export async function orgEnvironmentAction(userId: string, taskId: string, action: OrgAction, index?: number, answer?: number | null) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_org_environment", {
    p_user_id: userId, p_task_id: taskId, p_action: action,
    p_index: index ?? null, p_answer: answer ?? null,
  });
  if (result.error) return { error: result.error };
  const data = result.data as Record<string, unknown>;
  return typeof data.validationError === "string" ? { validationError: data.validationError } : { data };
}
