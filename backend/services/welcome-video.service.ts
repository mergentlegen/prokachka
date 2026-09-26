import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import type { AuthUser } from "@/shared/domain/types";
import { WELCOME_VIDEO_MAX_BYTES, WELCOME_VIDEO_MAX_SECONDS, type WelcomeVideoMetadata } from "@/shared/domain/welcome-video";

export const WELCOME_VIDEO_BUCKET = "welcome-videos";
export { WELCOME_VIDEO_MAX_BYTES } from "@/shared/domain/welcome-video";
const SIGNED_URL_SECONDS = 6 * 60 * 60;
// Stop issuing the URL 1h before token expiry so a 3-minute viewing can finish.
const URL_REUSE_SECONDS = 5 * 60 * 60;
const UPLOAD_INTENT_TTL_HOURS = 2;

type VideoRow = {
  id: string; team_id: string; owner_user_id: string; storage_path: string;
  file_name: string; size_bytes: number; duration_seconds: number; width: number; height: number;
};
type VideoMetadata = WelcomeVideoMetadata;

function publicVideo(row: VideoRow, url: string) {
  return {
    // Immutable file identity: a replacement must not inherit the old viewing position.
    id: row.storage_path.split("/").at(-1)!.replace(/\.mp4$/, ""), fileName: row.file_name, sizeBytes: Number(row.size_bytes), durationSeconds: Number(row.duration_seconds),
    width: row.width, height: row.height, url,
  };
}

async function signedUrl(path: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  // Only called AFTER checking current membership/branch. Never cache an API response.
  const cached = await supabase.from("welcome_video_url_cache").select("signed_url")
    .eq("storage_path", path).gt("refresh_at", new Date().toISOString()).maybeSingle();
  if (cached.error) return null;
  if (cached.data) return String(cached.data.signed_url);
  const result = await supabase.storage.from(WELCOME_VIDEO_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (result.error) return null;
  const canonical = await supabase.rpc("app_cache_welcome_video_url", {
    p_path: path, p_url: result.data.signedUrl,
    p_refresh_at: new Date(Date.now() + URL_REUSE_SECONDS * 1000).toISOString(),
  });
  return canonical.error || typeof canonical.data !== "string" ? null : canonical.data;
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

  const resolved = await supabase.rpc("app_resolve_welcome_video", { p_user_id: user.id, p_team_id: user.teamId });
  if (resolved.error) return { error: resolved.error };
  const selected = resolved.data?.[0] as VideoRow | undefined;
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
  if (own && !url) return { error: new Error("welcome_video_signed_url_failed") };
  return { data: { video: own && url ? publicVideo(own, url) : null } };
}

function isValidMetadata(value: unknown): value is VideoMetadata {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<VideoMetadata>;
  return typeof row.fileName === "string" && row.fileName.trim().length > 0 && row.fileName.length <= 180 && row.fileName.toLowerCase().endsWith(".mp4") &&
    Number.isInteger(row.sizeBytes) && Number(row.sizeBytes) >= 1024 && Number(row.sizeBytes) <= WELCOME_VIDEO_MAX_BYTES &&
    Number.isFinite(row.durationSeconds) && Number(row.durationSeconds) > 0 && Number(row.durationSeconds) <= WELCOME_VIDEO_MAX_SECONDS &&
    Number.isInteger(row.width) && Number(row.width) >= 1 && Number(row.width) <= 7680 &&
    Number.isInteger(row.height) && Number(row.height) >= 1 && Number(row.height) <= 7680;
}

export async function createWelcomeVideoUpload(user: AuthUser, metadata: unknown) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!user.teamId || !(user.role === "admin" || user.canPublishTasks)) {
    return { forbidden: true as const };
  }
  if (!isValidMetadata(metadata)) return { validationError: "Выберите MP4-видео длительностью до 3 минут и размером до 200 МБ. Любая ориентация." };
  // Read at runtime: a clean CI build must not bake in a missing/different public key.
  const runtimeEnv = process.env;
  const apiKey = runtimeEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const base = runtimeEnv.NEXT_PUBLIC_SUPABASE_URL;
  if (!apiKey || !base) return { unavailable: true as const };
  // Defence against accidental misconfiguration: never send a service-role/secret key.
  if (apiKey.startsWith("sb_secret_")) return { unavailable: true as const };
  if (!apiKey.startsWith("sb_publishable_")) {
    try { if (JSON.parse(Buffer.from(apiKey.split(".")[1], "base64url").toString()).role !== "anon") return { unavailable: true as const }; }
    catch { return { unavailable: true as const }; }
  }
  let endpoint: string;
  try {
    const url = new URL(base);
    const match = url.hostname.match(/^([^.]+)\.supabase\.co$/);
    endpoint = match ? `https://${match[1]}.storage.supabase.co/storage/v1/upload/resumable` : `${url.origin}/storage/v1/upload/resumable`;
  } catch { return { unavailable: true as const }; }
  const path = `${user.teamId}/${user.id}/${crypto.randomUUID()}.mp4`;
  const expiresAt = new Date(Date.now() + UPLOAD_INTENT_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const uploadIntent = await supabase.from("welcome_video_upload_intents").insert({
    storage_path: path, team_id: user.teamId, owner_user_id: user.id, expires_at: expiresAt,
  });
  if (uploadIntent.error) return { storageError: uploadIntent.error };
  const created = await supabase.storage.from(WELCOME_VIDEO_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (created.error) {
    await supabase.from("welcome_video_upload_intents").delete().eq("storage_path", path);
    return { storageError: created.error };
  }
  return { data: { path, token: created.data.token, bucket: WELCOME_VIDEO_BUCKET, endpoint, apiKey } };
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
  const probe = await fetch(probeUrl.data.signedUrl, { headers: { Range: "bytes=0-63" }, cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
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
  // The transaction consumes the intent and enqueues the old file. A lost response
  // may be retried safely; never delete this file on an ambiguous RPC failure.
  if (inserted.error) return { error: inserted.error };
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
  // A DB trigger durably enqueues Storage deletion (also works for account cascades).
  return { data: { storageCleanupWarning: false, cleanupPending: true } };
}

export async function cancelWelcomeVideoUpload(user: AuthUser, path: unknown) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!user.teamId || !(user.role === "admin" || user.canPublishTasks) || typeof path !== "string") return { forbidden: true as const };
  const removed = await supabase.from("welcome_video_upload_intents").delete()
    .eq("storage_path", path).eq("team_id", user.teamId).eq("owner_user_id", user.id);
  return removed.error ? { error: removed.error } : { data: true };
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
