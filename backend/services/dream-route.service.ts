import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export async function dreamRouteAction(userId: string, taskId: string, action: "start" | "save" | "complete", step = 0, answers: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_dream_route", {
    p_user_id: userId, p_task_id: taskId, p_action: action, p_step: step, p_answers: answers,
  });
  if (result.error) return { error: result.error };
  const data = result.data as Record<string, unknown>;
  return typeof data.validationError === "string" ? { validationError: data.validationError } : { data };
}
