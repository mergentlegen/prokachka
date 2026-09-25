import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { descendants, findTeamNetwork } from "@/backend/services/network.service";

type SubmissionViewer = { id: string; role: string; teamId?: string; canReview?: boolean };
type FindOptions = { userId?: string; teamId?: string; viewer?: SubmissionViewer };
const submissionSelect = "id,user_id,task_id,status,submission_source,media_type,answer_text,points,comment,submitted_at,reviewed_at,review_version,created_at";

export async function findMentorCounts(userId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_mentor_counts", { p_viewer: userId });
  return result.error ? { error: result.error } : { data: result.data };
}

export async function findSubmissionMedia(id: string, viewer?: SubmissionViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const result = await supabase
    .from("submissions")
    .select("telegram_file_id,media_type,users(id,team_id),tasks(team_id)")
    .eq("id", id)
    .maybeSingle();
  const task = Array.isArray(result.data?.tasks) ? result.data.tasks[0] : result.data?.tasks;
  if (result.error || !result.data) return { notFound: true as const };
  if (viewer?.role !== "ceo" && (!viewer?.teamId || String(task?.team_id || "") !== viewer.teamId)) return { forbidden: true as const };
  const submitter = Array.isArray(result.data.users) ? result.data.users[0] : result.data.users;
  if (viewer?.role !== "ceo" && submitter?.team_id !== viewer?.teamId) return { forbidden: true as const };
  if (viewer?.role === "member") {
    const network = await findTeamNetwork(viewer.teamId || "");
    if ("unavailable" in network) return { unavailable: true as const };
    if ("error" in network) return { error: network.error };
    if (!viewer.canReview || !descendants(network.data, viewer.id, false).has(String(submitter?.id || ""))) return { forbidden: true as const };
  }
  if (!result.data.telegram_file_id || !["photo", "video", "document"].includes(String(result.data.media_type))) {
    return { notFound: true as const };
  }
  return { data: { fileId: String(result.data.telegram_file_id), mediaType: String(result.data.media_type) } };
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
    }) };
  }
  return { data: rows };
}

export async function saveReview(id: string, input: { status: "accepted" | "revision"; points: number; comment: string; expectedVersion: number }, viewer?: SubmissionViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!viewer) return { forbidden: true as const };
  const result = await supabase.rpc("tg_review_submission", {
    p_id: id, p_reviewer: viewer.id === "ceo" ? null : viewer.id,
    p_ceo: viewer.role === "ceo", p_status: input.status,
    p_points: Math.round(input.points), p_comment: input.comment.trim(), p_expected_version: input.expectedVersion,
  });
  if (result.error) return { error: result.error };
  return result.data as { data?: Record<string, unknown>; forbidden?: boolean; validationError?: string };
}
