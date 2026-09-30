import sharp from "sharp";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { ANNOUNCEMENT_PHOTO_LIMIT } from "@/shared/domain/announcement-photos";

export const ANNOUNCEMENT_PHOTO_BUCKET = "announcement-photos";
export const ANNOUNCEMENT_PHOTO_INPUT_MAX_BYTES = 3 * 1024 * 1024;
const OUTPUT_MAX_BYTES = 2 * 1024 * 1024;
const SIGNED_SECONDS = 24 * 60 * 60;

export type StoredAnnouncementPhoto = {
  id: string;
  fullPath: string;
  thumbPath: string;
  width: number;
  height: number;
};

const signed = new Map<string, { until: number; url: string }>();
function safePhotos(value: unknown): StoredAnnouncementPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.filter((photo): photo is StoredAnnouncementPhoto =>
    photo && typeof photo === "object" && typeof photo.id === "string"
    && typeof photo.fullPath === "string" && typeof photo.thumbPath === "string"
    && Number.isInteger(photo.width) && Number.isInteger(photo.height));
}

export async function withAnnouncementPhotoUrls<T extends { photos?: unknown }>(rows: T[]) {
  const paths = [...new Set(rows.flatMap((row) => safePhotos(row.photos).flatMap((photo) => [photo.fullPath, photo.thumbPath])))];
  const now = Date.now();
  const missing = paths.filter((path) => !signed.has(path) || signed.get(path)!.until < now);
  if (missing.length) {
    try {
      const supabase = getSupabaseAdmin();
      if (!supabase) throw new Error("Storage is unavailable");
      for (let index = 0; index < missing.length; index += 100) {
        const batch = missing.slice(index, index + 100);
        const result = await supabase.storage.from(ANNOUNCEMENT_PHOTO_BUCKET).createSignedUrls(batch, SIGNED_SECONDS);
        if (result.error || !result.data || result.data.length !== batch.length) throw result.error || new Error("Photo signing failed");
        for (const item of result.data) {
          if (!item.signedUrl || !item.path) throw new Error("Photo signing failed");
          signed.set(item.path, { url: item.signedUrl, until: now + (SIGNED_SECONDS - 120) * 1000 });
        }
      }
      while (signed.size > 5000) signed.delete(signed.keys().next().value!);
    } catch {
      // The announcement has already been saved; a transient URL-signing error
      // must not turn a successful create/edit into an ambiguous HTTP failure.
      console.warn("Announcement photo URLs are temporarily unavailable");
    }
  }
  return rows.map((row) => ({ ...row, photos: safePhotos(row.photos).flatMap((photo) => {
    const url = signed.get(photo.fullPath)?.url;
    const thumbnailUrl = signed.get(photo.thumbPath)?.url;
    return url && thumbnailUrl ? [{ id: photo.id, width: photo.width, height: photo.height, url, thumbnailUrl }] : [];
  }) }));
}

export function validatePhotoFiles(files: File[], retained = 0): string | null {
  if (retained + files.length > ANNOUNCEMENT_PHOTO_LIMIT) return `Можно прикрепить не больше ${ANNOUNCEMENT_PHOTO_LIMIT} фотографий.`;
  for (const file of files) {
    if (!file.size || file.size > ANNOUNCEMENT_PHOTO_INPUT_MAX_BYTES) return "Подготовленная фотография должна весить не больше 3 МБ.";
    if (file.type && !["image/webp", "image/jpeg", "image/png", "application/octet-stream"].includes(file.type)) return "Загрузите фотографию JPG, PNG или WebP.";
  }
  return null;
}

// A durable, delayed cleanup intent covers a process crash between Storage upload
// and the database write. Referenced photos are never claimed by the worker.
export async function uploadAnnouncementPhotos(announcementId: string, files: File[]) {
  if (!files.length) return { data: [] as StoredAnnouncementPhoto[], paths: [] as string[] };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const prepared: Array<{ photo: StoredAnnouncementPhoto; full: Buffer; thumb: Buffer }> = [];
  try {
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const source = sharp(bytes, { limitInputPixels: 60_000_000, failOn: "warning" });
      const metadata = await source.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format || "") || (metadata.pages || 1) !== 1) return { validationError: "Не удалось прочитать фотографию. Выберите JPG, PNG или WebP." };
      const fullResult = await source.rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).webp({ quality: 84, effort: 4 }).toBuffer({ resolveWithObject: true });
      const full = fullResult.data.length <= OUTPUT_MAX_BYTES ? fullResult.data
        : await sharp(fullResult.data).webp({ quality: 68, effort: 4 }).toBuffer();
      if (full.length > OUTPUT_MAX_BYTES) return { validationError: "Фотография слишком сложная для обработки. Попробуйте другой снимок." };
      const thumb = await sharp(full).resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 76, effort: 4 }).toBuffer();
      const id = crypto.randomUUID();
      prepared.push({ photo: {
        id, fullPath: `${announcementId}/${id}-full.webp`, thumbPath: `${announcementId}/${id}-thumb.webp`,
        width: fullResult.info.width, height: fullResult.info.height,
      }, full, thumb });
    }
  } catch { return { validationError: "Не удалось обработать фотографию. Попробуйте другой файл." }; }
  const paths = prepared.flatMap(({ photo }) => [photo.fullPath, photo.thumbPath]);
  const queued = await supabase.from("announcement_photo_cleanup_queue")
    .insert(paths.map((storage_path) => ({ storage_path, next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() })));
  if (queued.error) return { error: queued.error };
  for (const { photo, full, thumb } of prepared) {
    for (const [path, buffer] of [[photo.fullPath, full], [photo.thumbPath, thumb]] as const) {
      const uploaded = await supabase.storage.from(ANNOUNCEMENT_PHOTO_BUCKET).upload(path, buffer, { contentType: "image/webp", cacheControl: "3600", upsert: false });
      if (uploaded.error) return { storageError: uploaded.error, paths };
    }
  }
  return { data: prepared.map(({ photo }) => photo), paths };
}

export async function releaseAnnouncementPhotoIntent(paths: string[]) {
  if (!paths.length) return;
  const supabase = getSupabaseAdmin();
  if (supabase) await supabase.from("announcement_photo_cleanup_queue").delete().in("storage_path", paths);
}
