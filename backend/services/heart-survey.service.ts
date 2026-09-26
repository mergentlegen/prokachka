import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { HEART_SURVEY } from "@/shared/domain/heart-survey";

export async function saveHeartSurvey(userId: string, taskId: string, action: "start" | "answer", answer?: number, questionIndex?: number) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_heart_survey", {
    p_user_id: userId, p_task_id: taskId, p_action: action,
    p_answer: answer ?? null, p_question_index: questionIndex ?? null, p_definition: HEART_SURVEY,
  });
  if (result.error) return { error: result.error };
  const data = result.data as Record<string, unknown>;
  return typeof data?.validationError === "string" ? { validationError: data.validationError } : { data };
}
