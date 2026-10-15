import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { withAvatarUrls } from "@/backend/services/avatar-urls.service";
import { releaseAnnouncementPhotoIntent, uploadAnnouncementPhotos, validatePhotoFiles, withAnnouncementPhotoUrls, type StoredAnnouncementPhoto } from "@/backend/services/announcement-photos.service";

type Viewer = { id: string; role: string; teamId?: string };
type Row = Record<string, unknown>;
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Every review with the summary; links to photos and avatars are signed here, storage paths never leave the server. */
export async function findReviews(viewer: Viewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const ceo = viewer.role === "ceo";
  const result = await supabase.rpc("app_reviews", { p_viewer: isUuid(viewer.id) ? viewer.id : null, p_limit: 300 });
  if (result.error) return { error: result.error };
  const data = (result.data || {}) as { summary?: Row; reviews?: Row[] };
  const rows = Array.isArray(data.reviews) ? data.reviews : [];
  const withAvatars = await withAvatarUrls(rows);
  const withPhotos = await withAnnouncementPhotoUrls(withAvatars.map(({ avatar_path: _path, avatar_url, ...row }) => ({ ...row, author_avatar_url: avatar_url ?? null })) as Array<Row & { photos?: unknown }>);
  return { data: { summary: data.summary || { count: 0, average: 0, stars: {} }, reviews: withPhotos.map((row) => ({ ...row, can_delete: ceo || (row as Row).can_delete === true, is_mine: (row as Row).user_id === viewer.id })) } };
}

/** Creates or edits the participant's only review. Photos: those kept from before plus new files. */
export async function saveReview(viewer: Viewer, input: { rating: number; body: string; keepPhotoIds?: string[]; photoFiles: File[] }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!isUuid(viewer.id)) return { validationError: "Отзыв могут оставить участники команды." };
  const current = await supabase.from("reviews").select("id,photos").eq("user_id", viewer.id).maybeSingle();
  if (current.error) return { error: current.error };
  const id = current.data ? String(current.data.id) : crypto.randomUUID();
  const existing = current.data && Array.isArray(current.data.photos) ? current.data.photos as StoredAnnouncementPhoto[] : [];
  const keep = input.keepPhotoIds;
  if (keep && (new Set(keep).size !== keep.length || keep.some((photoId) => !existing.some((photo) => photo.id === photoId))))
    return { validationError: "Фотографии отзыва изменились. Обновите страницу и попробуйте ещё раз." };
  const retained = keep ? existing.filter((photo) => keep.includes(photo.id)) : existing;
  const invalid = validatePhotoFiles(input.photoFiles, retained.length);
  if (invalid) return { validationError: invalid };
  const uploaded = await uploadAnnouncementPhotos(id, input.photoFiles);
  if (!uploaded.data || !uploaded.paths) return uploaded;
  const saved = await supabase.rpc("app_review_save", { p_user: viewer.id, p_id: id, p_rating: input.rating, p_body: input.body, p_photos: [...retained, ...uploaded.data] });
  if (saved.error) return { error: saved.error };
  const outcome = saved.data as { data?: Row; created?: boolean; validationError?: string };
  if (outcome.validationError) return { validationError: outcome.validationError };
  // Only now the new files belong to a saved review; until then the cleanup queue would remove them.
  await releaseAnnouncementPhotoIntent(uploaded.paths);
  return { data: outcome.data, created: outcome.created === true };
}

export async function deleteReview(viewer: Viewer, reviewId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_review_delete", { p_viewer: isUuid(viewer.id) ? viewer.id : null, p_review: reviewId, p_ceo: viewer.role === "ceo" });
  if (result.error) return { error: result.error };
  return { data: result.data as { deleted?: boolean; notFound?: boolean; forbidden?: boolean; own?: boolean; authorName?: string; teamId?: string; rating?: number } };
}
