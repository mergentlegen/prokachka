import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import type { AuthUser } from "@/shared/domain/types";

export const WELCOME_VIDEO_BUCKET = "welcome-videos";
export const WELCOME_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const SIGNED_URL_SECONDS = 60 * 60;
const UPLOAD_INTENT_TTL_HOURS = 2;

type VideoRow = {
  id: string; team_id: string; owner_user_id: string; storage_path: string;
  file_name: string; size_bytes: number; duration_seconds: number; width: number; height: number;
};
type VideoMetadata = { fileName: string; sizeBytes: number; durationSeconds: number; width: number; height: number };

function publicVideo(row: VideoRow, url: string) {
  return {
    fileName: row.file_name, sizeBytes: Number(row.size_bytes), durationSeconds: Number(row.duration_seconds),
    width: row.width, height: row.height, url,
  };
}

async function signedUrl(path: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const result = await supabase.storage.from(WELCOME_VIDEO_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  return result.error ? null : result.data.signedUrl;
}

export async function getWelcomeVideo(user: AuthUser) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (user.role === "ceo" || !user.teamId || !/^[0-9a-f-]{36}$/i.test(user.id)) return { data: { required: false as const } };
  const account = await supabase.from("users").select("team_id,welcome_video_completed_at,parent_user_id")
    .eq("id", user.id).maybeSingle();
  if (account.error) return { error: account.error };
  if (!account.data || !account.data.team_id || account.data.team_id !== user.teamId || account.data.welcome_video_completed_at) {
    return { data: { required: false as const } };
  }

  const users = new Map<string, { parent_user_id: string | null; can_publish_tasks: boolean; role: string }>();
  for (let offset = 0; ; offset += 500) {
    const result = await supabase.from("users").select("id,parent_user_id,can_publish_tasks,role")
      .eq("team_id", user.teamId).order("id", { ascending: true }).range(offset, offset + 499);
    if (result.error) return { error: result.error };
    for (const row of result.data || []) users.set(String(row.id), row);
    if ((result.data || []).length < 500) break;
  }
  const byOwner = new Map<string, VideoRow>();
  for (let offset = 0; ; offset += 500) {
    const result = await supabase.from("welcome_videos").select("*").eq("team_id", user.teamId)
      .order("id", { ascending: true }).range(offset, offset + 499);
    if (result.error) return { error: result.error };
    for (const row of result.data || []) byOwner.set(String(row.owner_user_id), row as VideoRow);
    if ((result.data || []).length < 500) break;
  }
  let parentId = account.data.parent_user_id ? String(account.data.parent_user_id) : "";
  const seen = new Set<string>([user.id]);
  let selected: VideoRow | undefined;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const ancestor = users.get(parentId);
    if (!ancestor) break;
    if (ancestor.role === "admin" || ancestor.can_publish_tasks) {
      selected = byOwner.get(parentId);
      if (selected) break;
    }
    parentId = ancestor.parent_user_id ? String(ancestor.parent_user_id) : "";
  }
  // The root mentor's clip is the team-wide fallback, including members whose
  // account has no parent link. A closer publisher above always takes priority.
  if (!selected) {
    const rootMentor = [...users.entries()].find(([, row]) => row.role === "admin" && !row.parent_user_id);
    if (rootMentor) selected = byOwner.get(rootMentor[0]);
  }
  if (!selected) return { data: { required: false as const, reason: "not-configured" as const } };
  const url = await signedUrl(selected.storage_path);
  if (!url) return { error: new Error("welcome_video_signed_url_failed") };
  return { data: { required: true as const, video: publicVideo(selected, url) } };
}

export async function getWelcomeVideoSettings(user: AuthUser) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!user.teamId || !(user.role === "admin" || user.canPublishTasks)) return { forbidden: true as const };
  const result = await supabase.from("welcome_videos").select("*").eq("team_id", user.teamId).eq("owner_user_id", user.id).maybeSingle();
  if (result.error) return { error: result.error };
  const own = result.data as VideoRow | null;
  const url = own ? await signedUrl(own.storage_path) : null;
  return { data: { video: own && url ? publicVideo(own, url) : null } };
}

function isValidMetadata(value: unknown): value is VideoMetadata {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<VideoMetadata>;
  return typeof row.fileName === "string" && row.fileName.trim().length > 0 && row.fileName.length <= 180 && row.fileName.toLowerCase().endsWith(".mp4") &&
    Number.isInteger(row.sizeBytes) && Number(row.sizeBytes) >= 1024 && Number(row.sizeBytes) <= WELCOME_VIDEO_MAX_BYTES &&
    Number.isFinite(row.durationSeconds) && Number(row.durationSeconds) > 0 && Number(row.durationSeconds) <= 180 &&
    Number.isInteger(row.width) && Number(row.width) >= 1 && Number(row.width) <= 7680 &&
    Number.isInteger(row.height) && Number(row.height) >= 1 && Number(row.height) <= 7680;
}

export async function createWelcomeVideoUpload(user: AuthUser, metadata: unknown) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!user.teamId || !(user.role === "admin" || user.canPublishTasks)) {
    return { forbidden: true as const };
  }
  if (!isValidMetadata(metadata)) return { validationError: "Выберите MP4-видео 16:9 длительностью до 3 минут и размером до 50 МБ." };
  const path = `${user.teamId}/${user.id}/${crypto.randomUUID()}.mp4`;
  const expiresAt = new Date(Date.now() + UPLOAD_INTENT_TTL_HOURS * 60 * 60 * 1000).toISOString();
  await supabase.from("welcome_video_upload_intents").delete().lt("expires_at", new Date().toISOString());
  const uploadIntent = await supabase.from("welcome_video_upload_intents").insert({
    storage_path: path, team_id: user.teamId, owner_user_id: user.id, expires_at: expiresAt,
  });
  if (uploadIntent.error) return { storageError: uploadIntent.error };
  const created = await supabase.storage.from(WELCOME_VIDEO_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (created.error) {
    await supabase.from("welcome_video_upload_intents").delete().eq("storage_path", path);
    return { storageError: created.error };
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return { unavailable: true as const };
  let endpoint: string;
  try {
    const url = new URL(base);
    const match = url.hostname.match(/^([^.]+)\.supabase\.co$/);
    endpoint = match ? `https://${match[1]}.storage.supabase.co/storage/v1/upload/resumable` : `${url.origin}/storage/v1/upload/resumable`;
  } catch { return { unavailable: true as const }; }
  return { data: { path, token: created.data.token, bucket: WELCOME_VIDEO_BUCKET, endpoint } };
}

export async function finishWelcomeVideoUpload(user: AuthUser, path: unknown, metadata: unknown) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!user.teamId || !(user.role === "admin" || user.canPublishTasks)) return { forbidden: true as const };
  if (typeof path !== "string" || !isValidMetadata(metadata)) return { validationError: "Данные загруженного видео некорректны." };
  const prefix = `${user.teamId}/${user.id}/`;
  if (!path.startsWith(prefix) || !/^[0-9a-f-]{36}\.mp4$/i.test(path.slice(prefix.length))) return { forbidden: true as const };
  const info = await supabase.storage.from(WELCOME_VIDEO_BUCKET).info(path);
  if (info.error || !info.data) return { storageError: info.error };
  if (Number(info.data.size) !== metadata.sizeBytes || info.data.contentType !== "video/mp4") return { validationError: "Файл не прошёл проверку размера или формата." };
  const probeUrl = await supabase.storage.from(WELCOME_VIDEO_BUCKET).createSignedUrl(path, 60);
  if (probeUrl.error) return { storageError: probeUrl.error };
  const probe = await fetch(probeUrl.data.signedUrl, { headers: { Range: "bytes=0-63" }, cache: "no-store" }).catch(() => null);
  if (!probe?.ok || !probe.body) return { validationError: "Не удалось прочитать заголовок видеофайла." };
  const reader = probe.body.getReader();
  const header = await reader.read().catch(() => ({ done: true as const, value: undefined }));
  void reader.cancel().catch(() => undefined);
  const bytes = header.value;
  if (!bytes || bytes.length < 8 || new TextDecoder("ascii").decode(bytes.slice(4, 8)) !== "ftyp") {
    return { validationError: "Файл не распознан как MP4-видео. Выберите корректный MP4 и попробуйте снова." };
  }
  const inserted = await supabase.rpc("app_set_welcome_video", {
    p_team_id: user.teamId, p_owner_user_id: user.id, p_storage_path: path,
    p_file_name: metadata.fileName.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().slice(0, 180) || "welcome.mp4",
    p_size_bytes: metadata.sizeBytes, p_duration_seconds: metadata.durationSeconds,
    p_width: metadata.width, p_height: metadata.height,
  });
  if (inserted.error) {
    await supabase.storage.from(WELCOME_VIDEO_BUCKET).remove([path]);
    await supabase.from("welcome_video_upload_intents").delete().eq("storage_path", path);
    return { error: inserted.error };
  }
  if (typeof inserted.data === "string" && inserted.data !== path) await supabase.storage.from(WELCOME_VIDEO_BUCKET).remove([inserted.data]);
  await supabase.from("welcome_video_upload_intents").delete().eq("storage_path", path);
  return { data: true };
}

export async function deleteWelcomeVideo(user: AuthUser) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!user.teamId || !(user.role === "admin" || user.canPublishTasks)) return { forbidden: true as const };
  const found = await supabase.from("welcome_videos").select("id,storage_path").eq("team_id", user.teamId).eq("owner_user_id", user.id).maybeSingle();
  if (found.error) return { error: found.error };
  if (!found.data) return { data: { storageCleanupWarning: false } };
  const removedRow = await supabase.from("welcome_videos").delete().eq("id", found.data.id);
  if (removedRow.error) return { error: removedRow.error };
  const removedFile = await supabase.storage.from(WELCOME_VIDEO_BUCKET).remove([found.data.storage_path]);
  return { data: { storageCleanupWarning: Boolean(removedFile.error) } };
}

export async function completeWelcomeVideo(user: AuthUser) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!user.teamId || user.role === "ceo") return { forbidden: true as const };
  const updated = await supabase.from("users").update({ welcome_video_completed_at: new Date().toISOString() })
    .eq("id", user.id).eq("team_id", user.teamId).is("welcome_video_completed_at", null).select("id").maybeSingle();
  if (updated.error) return { error: updated.error };
  if (updated.data) return { data: true };
  const existing = await supabase.from("users").select("welcome_video_completed_at").eq("id", user.id).eq("team_id", user.teamId).maybeSingle();
  return existing.data?.welcome_video_completed_at ? { data: true } : { error: existing.error || new Error("welcome_video_completion_failed") };
}
