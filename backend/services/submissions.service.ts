import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { advanceProgramAfterAcceptance, revertProgramAfterRevision } from "@/backend/services/member-progress.service";
import { canReviewNetwork, descendants, findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";

type SubmissionViewer = { id: string; role: string; teamId?: string; canReview?: boolean };
type FindOptions = { userId?: string; teamId?: string; viewer?: SubmissionViewer };
const submissionSelect = "id,user_id,task_id,status,media_type,answer_text,points,comment,submitted_at,reviewed_at,created_at";

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
  let query = supabase.from("submissions").select(`${submissionSelect}, users(id,name,team_id), tasks(title,max_points,team_id)`).order("submitted_at", { ascending: false });
  if (options.userId) query = query.eq("user_id", options.userId);
  if (options.teamId) query = query.eq("tasks.team_id", options.teamId);
  const result = await query;
  if (result.error) return { error: result.error };
  if (options.viewer?.role === "member") {
    const network = await findTeamNetwork(options.viewer.teamId || "");
    if ("unavailable" in network) return { unavailable: true as const };
    if ("error" in network) return { error: network.error };
    const allowed = descendants(network.data, options.viewer.id, false);
    return { data: (result.data || []).filter((row) => {
      const submitter = Array.isArray(row.users) ? row.users[0] : row.users;
      return options.viewer?.canReview === true && allowed.has(String(submitter?.id || ""));
    }) };
  }
  return { data: result.data };
}

async function validateSubmissionTarget(userId: string, taskId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const [user, task] = await Promise.all([
    supabase.from("users").select("team_id,team_joined_at").eq("id", userId).single(),
    supabase.from("tasks").select("team_id,is_active,deadline_at,publication_type,program_id,audience_root_id").eq("id", taskId).single(),
  ]);
  if (user.error || task.error || !task.data.is_active) return { validationError: "Задание недоступно." };
  if (!user.data.team_id || user.data.team_id !== task.data.team_id) return { validationError: "Пользователь не состоит в этой команде." };
  const network = await findTeamNetwork(String(task.data.team_id));
  if ("unavailable" in network) return { unavailable: true as const };
  if ("error" in network) return { error: network.error };
  if (!isAudienceVisible(network.data, userId, task.data.audience_root_id)) return { validationError: "Задание недоступно для этого участника." };
  const taskRow = task.data;
  if (taskRow.publication_type === "sequential") {
    const progress = await supabase.from("member_program_progress").select("current_task_id,status").eq("user_id", userId).eq("program_id", taskRow.program_id).maybeSingle();
    if (progress.error || !progress.data || progress.data.status !== "active" || progress.data.current_task_id !== taskId) return { validationError: "Сейчас доступен другой шаг программы." };
  } else if (taskRow.deadline_at && new Date(taskRow.deadline_at).getTime() <= Date.now()) {
    return { validationError: "Срок отправки уже истёк." };
  }
  return { supabase };
}

export async function insertSubmission(input: { userId: string; taskId: string; telegramChatId?: string; telegramMessageId?: string }) {
  const target = await validateSubmissionTarget(input.userId, input.taskId);
  if ("unavailable" in target) return { unavailable: true as const };
  if ("validationError" in target) return { validationError: target.validationError };
  if ("error" in target) return { error: target.error };
  const result = await target.supabase.from("submissions").insert({
    user_id: input.userId, task_id: input.taskId, status: "pending", telegram_chat_id: input.telegramChatId || null,
    telegram_message_id: input.telegramMessageId || null, points: 0, comment: "",
  }).select().single();
  return result.error ? { error: result.error } : { data: result.data };
}

export async function attachTelegramSubmission(input: {
  telegramId: string;
  chatId: string;
  messageId: string;
  taskId: string;
  updateId?: number;
  mediaType: "text" | "photo" | "video" | "document";
  answerText?: string;
  telegramFileId?: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const user = await supabase.from("users").select("id").eq("telegram_id", input.telegramId).maybeSingle();
  if (user.error) return { error: user.error };
  if (!user.data?.id) return { validationError: "Telegram аккаунт ещё не привязан к участнику." };
  const target = await validateSubmissionTarget(user.data.id, input.taskId);
  if ("unavailable" in target) return { unavailable: true as const };
  if ("validationError" in target) return { validationError: target.validationError };
  if (input.updateId !== undefined) {
    const duplicate = await supabase.from("submissions").select("*").eq("telegram_update_id", input.updateId).maybeSingle();
    if (duplicate.error) return { error: duplicate.error };
    if (duplicate.data) return { data: duplicate.data, duplicate: true as const };
  }
  const existing = await supabase.from("submissions").select("id").eq("user_id", user.data.id).eq("task_id", input.taskId).eq("status", "pending").order("submitted_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.error) return { error: existing.error };
  const telegramFields = {
    telegram_chat_id: input.chatId,
    telegram_message_id: input.messageId,
    telegram_update_id: input.updateId ?? null,
    media_type: input.mediaType,
    telegram_file_id: input.telegramFileId || null,
    answer_text: (input.answerText || "").slice(0, 10000),
    submitted_at: new Date().toISOString(),
  };
  if (existing.data?.id) {
    const updated = await supabase.from("submissions").update(telegramFields).eq("id", existing.data.id).select().single();
    return updated.error ? { error: updated.error } : { data: updated.data, duplicate: false as const };
  }
  const created = await supabase.from("submissions").insert({ user_id: user.data.id, task_id: input.taskId, status: "pending", ...telegramFields, points: 0, comment: "" }).select().single();
  if (!created.error) return { data: created.data, duplicate: false as const };
  if (created.error.code === "23505" && input.updateId !== undefined) {
    const duplicate = await supabase.from("submissions").select("*").eq("telegram_update_id", input.updateId).maybeSingle();
    if (!duplicate.error && duplicate.data) return { data: duplicate.data, duplicate: true as const };
  }
  return { error: created.error };
}

export async function saveReview(id: string, input: { status: "accepted" | "revision"; points: number; comment: string }, viewer?: SubmissionViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const current = await supabase.from("submissions").select("id,user_id,task_id,status,users(team_id),tasks(team_id,max_points)").eq("id", id).single();
  const task = Array.isArray(current.data?.tasks) ? current.data.tasks[0] : current.data?.tasks;
  if (current.error || !current.data) return { forbidden: true as const };
  if (viewer?.role !== "ceo" && (!viewer?.teamId || task?.team_id !== viewer.teamId)) return { forbidden: true as const };
  if (viewer?.role === "member") {
    const network = await findTeamNetwork(viewer.teamId || "");
    if ("unavailable" in network) return network;
    if ("error" in network) return network;
    if (!viewer.canReview || !canReviewNetwork(network.data, viewer.id, String(current.data.user_id), viewer.role)) return { forbidden: true as const };
  }
  const points = Math.min(Math.max(0, Math.round(input.points)), Number(task?.max_points ?? 100));
  const reviewedAt = new Date().toISOString();
  const result = await supabase.from("submissions").update({ status: input.status, points: input.status === "accepted" ? points : 0, comment: input.comment.trim(), reviewed_at: reviewedAt }).eq("id", id).select().single();
  if (result.error) return { error: result.error };
  if (input.status === "accepted") {
    const advanced = await advanceProgramAfterAcceptance(String(current.data.user_id), String(current.data.task_id), reviewedAt);
    if ("error" in advanced && advanced.error) return { error: advanced.error };
  } else if (current.data.status === "accepted") {
    const reverted = await revertProgramAfterRevision(String(current.data.user_id), String(current.data.task_id), reviewedAt);
    if ("error" in reverted && reverted.error) return { error: reverted.error };
  }
  return { data: result.data };
}
