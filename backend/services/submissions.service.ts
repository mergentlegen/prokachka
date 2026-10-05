import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { descendants, findTeamNetwork } from "@/backend/services/network.service";

type SubmissionViewer = { id: string; role: string; teamId?: string; canReview?: boolean };
type FindOptions = { userId?: string; teamId?: string; viewer?: SubmissionViewer };
const submissionSelect = "id,user_id,task_id,status,submission_source,interactive_completed,media_type,answer_text,quiz_score,quiz_total,points,comment,submitted_at,reviewed_at,review_version,created_at";
// Team lists carry the whole history; reviewed answers travel as a preview, the full text opens on demand.
export const ANSWER_PREVIEW_LENGTH = 300;

export function previewAnswer<T extends { status?: unknown; answer_text?: unknown }>(row: T): T & { answer_truncated?: true } {
  const text = typeof row.answer_text === "string" ? row.answer_text : "";
  if (row.status === "pending" || text.length <= ANSWER_PREVIEW_LENGTH) return row;
  return { ...row, answer_text: text.slice(0, ANSWER_PREVIEW_LENGTH).trimEnd(), answer_truncated: true };
}

export async function findMentorCounts(userId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_mentor_counts", { p_viewer: userId });
  return result.error ? { error: result.error } : { data: result.data };
}

// The same rule for a submission's file and its full text: the CEO, the team's leader, or a reviewer above the author.
type Reviewable = { unavailable: true } | { notFound: true } | { forbidden: true } | { error: unknown } | { row: Record<string, unknown> };
async function reviewableSubmission(id: string, viewer: SubmissionViewer | undefined, columns: string): Promise<Reviewable> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase
    .from("submissions")
    .select(`${columns},users(id,team_id),tasks(team_id)`)
    .eq("id", id)
    .maybeSingle();
  if (result.error || !result.data) return { notFound: true as const };
  const row = result.data as unknown as Record<string, unknown> & { users?: unknown; tasks?: unknown };
  const task = (Array.isArray(row.tasks) ? row.tasks[0] : row.tasks) as { team_id?: string } | undefined;
  if (viewer?.role !== "ceo" && (!viewer?.teamId || String(task?.team_id || "") !== viewer.teamId)) return { forbidden: true as const };
  const submitter = (Array.isArray(row.users) ? row.users[0] : row.users) as { id?: string; team_id?: string } | undefined;
  if (viewer?.role !== "ceo" && submitter?.team_id !== viewer?.teamId) return { forbidden: true as const };
  if (viewer?.role === "member") {
    const network = await findTeamNetwork(viewer.teamId || "");
    if ("unavailable" in network) return { unavailable: true as const };
    if ("error" in network) return { error: network.error };
    if (!viewer.canReview || !descendants(network.data, viewer.id, false).has(String(submitter?.id || ""))) return { forbidden: true as const };
  }
  return { row };
}

export async function findSubmissionMedia(id: string, viewer?: SubmissionViewer) {
  const result = await reviewableSubmission(id, viewer, "telegram_file_id,media_type");
  if (!("row" in result)) return result;
  if (!result.row.telegram_file_id || !["photo", "video", "document"].includes(String(result.row.media_type))) {
    return { notFound: true as const };
  }
  return { data: { fileId: String(result.row.telegram_file_id), mediaType: String(result.row.media_type) } };
}

export async function findSubmissionAnswer(id: string, viewer?: SubmissionViewer) {
  const result = await reviewableSubmission(id, viewer, "answer_text");
  if (!("row" in result)) return result;
  return { data: { answerText: typeof result.row.answer_text === "string" ? result.row.answer_text : "" } };
}

export async function findSubmissions(options: FindOptions = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("submissions").select(`${submissionSelect}, users!inner(id,name,team_id), tasks!inner(title,max_points,team_id)`).order("submitted_at", { ascending: false }).order("id", { ascending: false });
  if (options.userId) query = query.eq("user_id", options.userId);
  if (options.teamId) query = query.eq("tasks.team_id", options.teamId).eq("users.team_id", options.teamId);
  // Ignore legacy placeholders, but retain already reviewed history without rewriting scores.
  query = query.or("status.neq.pending,media_type.not.is.null,answer_text.neq.");
  let result = await query.range(0, 499);
  if (result.error) return { error: result.error };
  const rows = [...(result.data || [])];
  for (let offset = 500; result.data?.length === 500; offset += 500) {
    result = await query.range(offset, offset + 499);
    if (result.error) return { error: result.error };
    rows.push(...(result.data || []));
  }
  if (!options.userId && options.viewer?.role === "member") {
    const network = await findTeamNetwork(options.viewer.teamId || "");
    if ("unavailable" in network) return { unavailable: true as const };
    if ("error" in network) return { error: network.error };
    const allowed = descendants(network.data, options.viewer.id, false);
    return { data: rows.filter((row) => {
      const submitter = Array.isArray(row.users) ? row.users[0] : row.users;
      return options.viewer?.canReview === true && allowed.has(String(submitter?.id || ""));
    }).map(previewAnswer) };
  }
  // A participant's own list stays complete; mentors' team lists get previews.
  return { data: options.userId ? rows : rows.map(previewAnswer) };
}

export async function saveReview(id: string, input: { status: "accepted" | "revision"; points: number; comment: string; expectedVersion: number }, viewer?: SubmissionViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!viewer) return { forbidden: true as const };
  const result = await supabase.rpc("app_feedback_review_submission", {
    p_id: id, p_reviewer: viewer.id === "ceo" ? null : viewer.id,
    p_ceo: viewer.role === "ceo", p_status: input.status,
    p_points: Math.round(input.points), p_comment: input.comment.trim(), p_expected_version: input.expectedVersion,
  });
  if (result.error) return { error: result.error };
  return result.data as { data?: Record<string, unknown>; forbidden?: boolean; validationError?: string };
}

/** Records and accepts a completion the participant never sent, e.g. a test passed on an external site. */
export async function recordMentorCompletion(input: { taskId: string; memberId: string; points: number; comment: string }, viewer?: SubmissionViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!viewer) return { forbidden: true as const };
  const result = await supabase.rpc("app_mentor_record_submission", {
    p_task: input.taskId, p_member: input.memberId, p_reviewer: viewer.id === "ceo" ? null : viewer.id,
    p_ceo: viewer.role === "ceo", p_points: Math.round(input.points), p_comment: input.comment.trim(),
  });
  if (result.error) return { error: result.error };
  return result.data as { data?: Record<string, unknown>; forbidden?: boolean; validationError?: string };
}
