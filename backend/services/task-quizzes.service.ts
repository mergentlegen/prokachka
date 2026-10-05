import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { canOpenTaskMaterials } from "@/backend/services/task-access.service";
import { canManageTaskMaterials } from "@/backend/services/task-videos.service";
import { cleanAnswers, firstUnanswered, gradeQuiz, publicQuiz, validateQuiz, type PublicQuizQuestion, type QuizAnswers, type QuizQuestion } from "@/shared/domain/task-quiz";
import type { AuthUser } from "@/shared/domain/types";

export type MemberQuiz = {
  questions: PublicQuizQuestion[]; answers: QuizAnswers;
  videoRequired: boolean; videoCompleted: boolean;
};

type LoadedQuiz = { unavailable: true } | { notFound: true } | { error: unknown } | { data: { questions: QuizQuestion[]; teamId: string } };
async function loadQuiz(taskId: string): Promise<LoadedQuiz> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const found = await supabase.from("task_quizzes").select("questions,tasks(team_id)").eq("task_id", taskId).maybeSingle();
  if (found.error) return { error: found.error };
  if (!found.data) return { notFound: true as const };
  const task = (Array.isArray(found.data.tasks) ? found.data.tasks[0] : found.data.tasks) as { team_id?: string } | undefined;
  // Stored questions were validated on save; validate again so a damaged row can never break a page.
  const checked = validateQuiz(found.data.questions);
  if ("error" in checked) return { error: new Error("task_quiz_invalid") };
  return { data: { questions: checked.questions, teamId: String(task?.team_id || "") } };
}

/** How many questions each task has; the card shows it and the answer button changes. */
export async function taskQuizSummaries(taskIds: string[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !taskIds.length) return new Map<string, { questions: number }>();
  const result = await supabase.from("task_quizzes").select("task_id,questions").in("task_id", taskIds);
  if (result.error) return new Map<string, { questions: number }>();
  return new Map((result.data || []).map((row) => [String(row.task_id), { questions: Array.isArray(row.questions) ? row.questions.length : 0 }]));
}

/** The editor's copy, with the correct choices: only for those who may change the task. */
export async function getQuizForEditing(user: AuthUser, taskId: string) {
  const allowed = await canManageTaskMaterials(user, taskId);
  if (allowed === null) return { unavailable: true as const };
  if (!allowed) return { forbidden: true as const };
  const quiz = await loadQuiz(taskId);
  if ("notFound" in quiz) return { data: [] as QuizQuestion[] };
  if (!("data" in quiz)) return quiz;
  return { data: quiz.data.questions };
}

export async function saveQuiz(user: AuthUser, taskId: string, input: unknown) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const checked = validateQuiz(input);
  if ("error" in checked) return { validationError: checked.error };
  const result = await supabase.rpc("app_task_quiz_save", { p_actor: user.id, p_task: taskId, p_questions: checked.questions });
  if (result.error) return { error: result.error };
  if ((result.data as { forbidden?: boolean })?.forbidden) return { forbidden: true as const };
  return { data: checked.questions };
}

/** A participant's view: questions without answers, their saved draft (or last answers after a return), and the video gate. */
export async function getQuizForMember(user: AuthUser, taskId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const quiz = await loadQuiz(taskId);
  if (!("data" in quiz)) return quiz;
  if (!(await canOpenTaskMaterials(user, taskId, quiz.data.teamId))) return { forbidden: true as const };
  const questions = publicQuiz(quiz.data.questions);
  const [draft, last, video, watched] = await Promise.all([
    supabase.from("task_quiz_drafts").select("answers").eq("user_id", user.id).eq("task_id", taskId).maybeSingle(),
    supabase.from("submissions").select("quiz_answers").eq("user_id", user.id).eq("task_id", taskId).eq("submission_source", "site").order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("task_videos").select("video_path").eq("task_id", taskId).maybeSingle(),
    supabase.from("task_video_views").select("completed_at").eq("user_id", user.id).eq("task_id", taskId).maybeSingle(),
  ]);
  if (draft.error || last.error || video.error || watched.error) return { error: draft.error || last.error || video.error || watched.error };
  return { data: {
    questions,
    answers: cleanAnswers(questions, draft.data?.answers ?? last.data?.quiz_answers ?? {}),
    videoRequired: Boolean(video.data?.video_path),
    videoCompleted: Boolean(watched.data?.completed_at),
  } satisfies MemberQuiz };
}

export async function saveQuizDraft(user: AuthUser, taskId: string, input: unknown) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (user.role !== "member") return { forbidden: true as const };
  const quiz = await loadQuiz(taskId);
  if (!("data" in quiz)) return quiz;
  // A draft is private scratch space: team membership is enough; sending checks everything else.
  if (quiz.data.teamId !== user.teamId) return { forbidden: true as const };
  const answers = cleanAnswers(publicQuiz(quiz.data.questions), input);
  const saved = await supabase.from("task_quiz_drafts").upsert({ user_id: user.id, task_id: taskId, answers, updated_at: new Date().toISOString() }, { onConflict: "user_id,task_id" });
  return saved.error ? { error: saved.error } : { data: true };
}

export async function submitQuiz(user: AuthUser, taskId: string, input: unknown) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (user.role !== "member") return { forbidden: true as const };
  const quiz = await loadQuiz(taskId);
  if (!("data" in quiz)) return quiz;
  if (quiz.data.teamId !== user.teamId) return { forbidden: true as const };
  const answers = cleanAnswers(publicQuiz(quiz.data.questions), input);
  const missing = firstUnanswered(quiz.data.questions, answers);
  if (missing) return { validationError: `Ответьте на вопрос ${missing}.` };
  // Scored here with the correct choices the browser never sees.
  const graded = gradeQuiz(quiz.data.questions, answers);
  const result = await supabase.rpc("app_task_quiz_submit", { p_user: user.id, p_task: taskId, p_answer_text: graded.text, p_score: graded.score, p_total: graded.total, p_answers: answers });
  if (result.error) return { error: result.error };
  const payload = result.data as { data?: Record<string, unknown>; validationError?: string };
  if (payload.validationError) return { validationError: payload.validationError };
  return { data: { submission: payload.data!, score: graded.score, total: graded.total } };
}

/** Who watched the task video and how far; for the mentor's "who did the task" list. */
export async function taskVideoViews(user: AuthUser, taskId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (user.role === "member" && !user.canReview && !user.canPublishTasks) return { forbidden: true as const };
  const task = await supabase.from("tasks").select("team_id").eq("id", taskId).maybeSingle();
  if (task.error) return { error: task.error };
  if (!task.data || (user.role !== "ceo" && task.data.team_id !== user.teamId)) return { forbidden: true as const };
  const [video, views] = await Promise.all([
    supabase.from("task_videos").select("duration_seconds").eq("task_id", taskId).maybeSingle(),
    supabase.from("task_video_views").select("user_id,watched_seconds,completed_at").eq("task_id", taskId),
  ]);
  if (video.error || views.error) return { error: video.error || views.error };
  const duration = Number(video.data?.duration_seconds || 0);
  return { data: (views.data || []).map((row) => ({
    userId: String(row.user_id), completed: Boolean(row.completed_at),
    percent: row.completed_at ? 100 : duration ? Math.min(99, Math.round((Number(row.watched_seconds) / duration) * 100)) : 0,
  })) };
}
