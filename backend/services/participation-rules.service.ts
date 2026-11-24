import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

// «Правила участия»: the database lets a wrong answer be changed until it is right and gives the 5 miles once, at the finish.
export async function participationRulesAction(userId: string, taskId: string, operation: "start" | "answer", question = 0, answer = 0) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_participation_rules", { p_user_id: userId, p_task_id: taskId, p_action: operation, p_question: question, p_answer: answer });
  if (result.error) return { error: result.error };
  const data = result.data as Record<string, unknown>;
  return typeof data.validationError === "string" ? { validationError: data.validationError } : { data };
}
