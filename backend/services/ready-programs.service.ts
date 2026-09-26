import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export type ReadyAttemptAction = "start" | "advance" | "answer" | "restart-quiz" | "complete";

type ReadyAttemptResult = { data: Record<string, unknown> } | { validationError: string } | { error: { message?: string; code?: string } } | { unavailable: true };

async function call(supabase: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }> }, name: string, args: Record<string, unknown>): Promise<ReadyAttemptResult> {
  const result = await supabase.rpc(name, args);
  if (result.error) return { error: result.error };
  const data = (result.data || {}) as Record<string, unknown>;
  return typeof data.validationError === "string" ? { validationError: data.validationError } : { data };
}

export function startReadyProgramAttempt(userId: string, taskId: string, restart = false): Promise<ReadyAttemptResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return Promise.resolve({ unavailable: true });
  return call(supabase, "app_start_ready_program", { p_user_id: userId, p_task_id: taskId, p_restart: restart });
}

export function advanceReadyProgramAttempt(userId: string, taskId: string, step: number): Promise<ReadyAttemptResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return Promise.resolve({ unavailable: true });
  return call(supabase, "app_advance_ready_program", { p_user_id: userId, p_task_id: taskId, p_step: step });
}

export function answerReadyProgramAttempt(userId: string, taskId: string, answer: number, questionIndex?: number): Promise<ReadyAttemptResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return Promise.resolve({ unavailable: true });
  return call(supabase, "app_answer_ready_program", { p_user_id: userId, p_task_id: taskId, p_answer: answer, p_expected_question_index: questionIndex ?? null });
}

export function restartReadyProgramQuizAttempt(userId: string, taskId: string): Promise<ReadyAttemptResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return Promise.resolve({ unavailable: true });
  return call(supabase, "app_restart_ready_program_quiz", { p_user_id: userId, p_task_id: taskId });
}

export function completeReadyProgramAttempt(userId: string, taskId: string): Promise<ReadyAttemptResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return Promise.resolve({ unavailable: true });
  return call(supabase, "app_complete_ready_program", { p_user_id: userId, p_task_id: taskId });
}
