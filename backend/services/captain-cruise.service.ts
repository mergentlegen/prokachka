import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { prepareTelegramSubmission } from "./telegram-submission.service";

export type CaptainAction = "start" | "checkpoint" | "retry" | "finish" | "save-details" | "telegram-link";
export async function captainCruiseAction(userId: string, taskId: string, action: CaptainAction, index?: number, payload: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_captain_cruise", { p_user_id: userId, p_task_id: taskId, p_action: action === "telegram-link" ? "save-details" : action, p_expected_index: index ?? null, p_payload: payload });
  if (result.error) return { error: result.error };
  if (result.data?.validationError) return { validationError: String(result.data.validationError) };
  if (action === "telegram-link") return prepareTelegramSubmission(userId, taskId, "captain-screenshot");
  return { data: result.data as Record<string, unknown> };
}
