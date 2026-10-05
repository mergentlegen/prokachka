import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { resumableUploadTarget } from "@/backend/infrastructure/supabase/resumable-upload";
import { canOpenTaskMaterials } from "@/backend/services/task-access.service";
import { TASK_VIDEO_MAX_BYTES, TASK_VIDEO_TYPES, type TaskVideoSummary, type TaskVideoView } from "@/shared/domain/task-video";
import type { AuthUser } from "@/shared/domain/types";

export const TASK_VIDEO_BUCKET = "task-videos";
// One link per file is shared by viewers; it is handed out for an hour and stays valid for another,
// so a started lesson always finishes. A copied link is useless after at most two hours.
const SIGNED_URL_SECONDS = 2 * 60 * 60;
const URL_REUSE_SECONDS = 60 * 60;

type VideoRow = {
  task_id: string; team_id: string; status: TaskVideoSummary["status"]; video_path: string | null; source_path: string | null;
  file_name: string; duration_seconds: number | null; last_error: string | null;
};

function summary(row: VideoRow, manager: boolean): TaskVideoSummary {
  return {
    status: row.status, playable: Boolean(row.video_path),
    durationSeconds: row.duration_seconds ? Number(row.duration_seconds) : undefined,
    ...(manager && row.last_error ? { error: row.last_error } : {}),
  };
}

/** Video status for a list of tasks. Participants never see videos that cannot be played yet. */
export async function taskVideoSummaries(taskIds: string[], manager: boolean) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !taskIds.length) return new Map<string, TaskVideoSummary>();
  const result = await supabase.from("task_videos").select("task_id,team_id,status,video_path,source_path,file_name,duration_seconds,last_error").in("task_id", taskIds);
  if (result.error) return new Map<string, TaskVideoSummary>();
  return new Map((result.data as VideoRow[]).filter((row) => manager || row.video_path).map((row) => [String(row.task_id), summary(row, manager)]));
}

export async function canManageTaskMaterials(user: AuthUser, taskId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const result = await supabase.rpc("app_task_video_can_manage", { p_actor: user.id, p_task: taskId });
  return result.error ? null : Boolean(result.data);
}


async function signedUrl(path: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const cached = await supabase.from("task_video_url_cache").select("signed_url").eq("storage_path", path).gt("refresh_at", new Date().toISOString()).maybeSingle();
  if (cached.error) return null;
  if (cached.data) return String(cached.data.signed_url);
  const created = await supabase.storage.from(TASK_VIDEO_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (created.error) return null;
  const canonical = await supabase.rpc("app_cache_task_video_url", { p_path: path, p_url: created.data.signedUrl, p_refresh_at: new Date(Date.now() + URL_REUSE_SECONDS * 1000).toISOString() });
  return canonical.error || typeof canonical.data !== "string" ? null : canonical.data;
}

export async function getTaskVideo(user: AuthUser, taskId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const found = await supabase.from("task_videos").select("task_id,team_id,status,video_path,source_path,file_name,duration_seconds,last_error").eq("task_id", taskId).maybeSingle();
  if (found.error) return { error: found.error };
  const row = found.data as VideoRow | null;
  if (!row) return { notFound: true as const };
  if (!(await canOpenTaskMaterials(user, taskId, row.team_id))) return { forbidden: true as const };
  const manager = user.role !== "member" || Boolean(await canManageTaskMaterials(user, taskId));
  if (!row.video_path) return manager ? { data: { ...summary(row, true), fileName: row.file_name, watchedSeconds: 0, completed: false } satisfies TaskVideoView } : { notFound: true as const };
  const url = await signedUrl(row.video_path);
  if (!url) return { error: new Error("task_video_signed_url_failed") };
  let watchedSeconds = 0, completed = false;
  if (user.role === "member" && !manager) {
    // Opening the video starts the viewing record; later progress reports need it.
    const progress = await supabase.rpc("app_task_video_progress", { p_user: user.id, p_task: taskId, p_position: 0 });
    const data = (progress.data as { data?: { watchedSeconds: number; completed: boolean } } | null)?.data;
    if (progress.error || !data) return { error: progress.error || new Error("task_video_progress_failed") };
    watchedSeconds = Number(data.watchedSeconds); completed = data.completed;
  }
  return { data: { ...summary(row, manager), url, fileName: manager ? row.file_name : undefined, watchedSeconds, completed } satisfies TaskVideoView };
}

export async function recordTaskVideoProgress(user: AuthUser, taskId: string, position: number) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  // Only a participant who opened the video through getTaskVideo (which checked access) has a record.
  const opened = await supabase.from("task_video_views").select("task_id").eq("user_id", user.id).eq("task_id", taskId).maybeSingle();
  if (opened.error) return { error: opened.error };
  if (!opened.data) return { forbidden: true as const };
  const result = await supabase.rpc("app_task_video_progress", { p_user: user.id, p_task: taskId, p_position: position });
  if (result.error) return { error: result.error };
  const payload = result.data as { data?: { watchedSeconds: number; completed: boolean }; notFound?: boolean };
  if (!payload?.data) return { notFound: true as const };
  return { data: { watchedSeconds: Number(payload.data.watchedSeconds), completed: payload.data.completed } };
}

export async function beginTaskVideoUpload(user: AuthUser, taskId: string, input: { fileName: unknown; sizeBytes: unknown; contentType: unknown }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const extension = typeof input.contentType === "string" ? TASK_VIDEO_TYPES[input.contentType] : undefined;
  const size = Number(input.sizeBytes);
  if (!extension || typeof input.fileName !== "string" || !input.fileName.trim() || !Number.isInteger(size) || size < 1024 || size > TASK_VIDEO_MAX_BYTES) {
    return { validationError: "Выберите видео MP4, MOV или WebM размером до 1 ГБ." };
  }
  const target = resumableUploadTarget();
  if (!target) return { unavailable: true as const };
  const task = await supabase.from("tasks").select("team_id").eq("id", taskId).maybeSingle();
  if (task.error) return { error: task.error };
  if (!task.data) return { forbidden: true as const };
  const path = `${task.data.team_id}/${taskId}/${crypto.randomUUID()}.${extension}`;
  const issued = await supabase.rpc("app_task_video_begin_upload", { p_actor: user.id, p_task: taskId, p_path: path });
  if (issued.error) return { error: issued.error };
  if (!issued.data) return { forbidden: true as const };
  const created = await supabase.storage.from(TASK_VIDEO_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (created.error) return { storageError: created.error };
  return { data: { path, token: created.data.token, bucket: TASK_VIDEO_BUCKET, contentType: String(input.contentType), ...target } };
}

export async function finishTaskVideoUpload(user: AuthUser, taskId: string, input: { path: unknown; fileName: unknown; sizeBytes: unknown }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (typeof input.path !== "string" || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|mov|webm)$/.test(input.path) || input.path.split("/")[1] !== taskId) {
    return { validationError: "Данные загруженного видео некорректны." };
  }
  // Size and type are read from Storage itself, not trusted from the browser.
  const info = await supabase.storage.from(TASK_VIDEO_BUCKET).info(input.path);
  if (info.error || !info.data) return { validationError: "Видео не загрузилось до конца. Попробуйте ещё раз." };
  const size = Number(info.data.size);
  if (!TASK_VIDEO_TYPES[String(info.data.contentType)] || size < 1024 || size > TASK_VIDEO_MAX_BYTES || (input.sizeBytes !== undefined && size !== Number(input.sizeBytes))) {
    return { validationError: "Файл не прошёл проверку размера или формата." };
  }
  const fileName = typeof input.fileName === "string" ? input.fileName.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().slice(0, 180) : "";
  const result = await supabase.rpc("app_task_video_register", { p_actor: user.id, p_task: taskId, p_path: input.path, p_file_name: fileName || "video", p_size: size });
  if (result.error) return { error: result.error };
  const payload = result.data as { data?: true; forbidden?: true; validationError?: string };
  if (payload.forbidden) return { forbidden: true as const };
  if (payload.validationError) return { validationError: payload.validationError };
  return { data: true };
}

export async function removeTaskVideo(user: AuthUser, taskId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const allowed = await canManageTaskMaterials(user, taskId);
  if (allowed === null) return { error: new Error("task_video_permission_failed") };
  if (!allowed) return { forbidden: true as const };
  // The table trigger queues the files for deletion from Storage.
  const removed = await supabase.from("task_videos").delete().eq("task_id", taskId);
  return removed.error ? { error: removed.error } : { data: true };
}
