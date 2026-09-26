import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { AVATAR_BUCKET, AVATAR_SIZE, AVATAR_UPLOAD_MAX_BYTES, AVATAR_STORED_MAX_BYTES } from "@/shared/domain/profile";

export async function normalizeAvatar(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > AVATAR_UPLOAD_MAX_BYTES) throw new Error("invalid_avatar_size");
  const image = sharp(bytes, { limitInputPixels: 4_000_000, failOn: "warning" });
  const metadata = await image.metadata();
  if (!["jpeg", "png", "webp"].includes(metadata.format || "") || (metadata.pages || 1) !== 1) throw new Error("invalid_avatar_format");
  const normalized = image.autoOrient().resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", withoutEnlargement: true });
  let result = await normalized.clone().webp({ quality: 82, effort: 4 }).toBuffer();
  if (result.length > AVATAR_STORED_MAX_BYTES) result = await normalized.clone().webp({ quality: 60, effort: 4 }).toBuffer();
  if (result.length > AVATAR_STORED_MAX_BYTES) throw new Error("avatar_too_complex");
  // Sharp strips EXIF/GPS and other source metadata by default.
  return result;
}

export async function saveOwnProfile(userId: string, input: {
  firstName: string; lastName: string; expectedVersion: string; avatarAction: "keep" | "replace" | "remove"; avatar?: Buffer;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let path: string | null = null;
  if (input.avatarAction === "replace" && input.avatar) {
    path = `${userId}/${randomUUID()}.webp`;
    // An intent makes interrupted uploads reclaimable, including account deletion.
    const intent = await supabase.from("profile_avatar_uploads").insert({ storage_path: path, user_id: userId });
    if (intent.error) return { error: intent.error };
    const uploaded = await supabase.storage.from(AVATAR_BUCKET).upload(path, input.avatar, {
      contentType: "image/webp", cacheControl: "86400", upsert: false,
    });
    if (uploaded.error) {
      await supabase.from("profile_avatar_uploads").delete().eq("storage_path", path).eq("user_id", userId);
      return { storageError: uploaded.error };
    }
  }
  const result = await supabase.rpc("app_update_profile", {
    p_user_id: userId, p_first_name: input.firstName, p_last_name: input.lastName,
    p_expected_version: input.expectedVersion, p_avatar_action: input.avatarAction, p_avatar_path: path,
  });
  // On an ambiguous RPC failure leave the intent for the cleanup worker; the file
  // may already have become active. Never compensate by deleting a live avatar.
  if (result.error) return { error: result.error };
  const outcome = result.data as { conflict?: boolean; saved?: boolean } | null;
  if (outcome?.conflict) return { conflict: true as const };
  return outcome?.saved ? { data: true as const } : { error: new Error("profile_update_failed") };
}
