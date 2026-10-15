import type { AnnouncementPhoto, Review, ReviewSummary } from "@/shared/domain/types";
import { ApiError, authFetch, request } from "@/frontend/shared/api/client";

type ApiRow = Record<string, unknown>;

function mapPhotos(value: unknown): AnnouncementPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.filter((photo): photo is ApiRow => Boolean(photo && typeof photo === "object"))
    .filter((photo) => typeof photo.id === "string" && typeof photo.url === "string" && typeof photo.thumbnailUrl === "string")
    .map((photo) => ({ id: String(photo.id), url: String(photo.url), thumbnailUrl: String(photo.thumbnailUrl), width: Number(photo.width) || 1, height: Number(photo.height) || 1 }));
}

export function mapReview(row: ApiRow): Review {
  return {
    id: String(row.id), userId: String(row.user_id), authorName: String(row.author_name || "Участник"),
    authorAvatarUrl: row.author_avatar_url ? String(row.author_avatar_url) : undefined, teamName: row.team_name ? String(row.team_name) : undefined,
    rating: Math.min(5, Math.max(1, Number(row.rating) || 1)), body: String(row.body || ""), photos: mapPhotos(row.photos),
    createdAt: String(row.created_at || new Date().toISOString()), editedAt: row.edited_at ? String(row.edited_at) : undefined,
    canDelete: row.can_delete === true, isMine: row.is_mine === true,
  };
}

export function mapReviewSummary(row: unknown): ReviewSummary {
  const data = (row && typeof row === "object" ? row : {}) as ApiRow;
  const stars = (data.stars && typeof data.stars === "object" ? data.stars : {}) as ApiRow;
  return { count: Number(data.count) || 0, average: Number(data.average) || 0, stars: { 5: Number(stars["5"]) || 0, 4: Number(stars["4"]) || 0, 3: Number(stars["3"]) || 0, 2: Number(stars["2"]) || 0, 1: Number(stars["1"]) || 0 } };
}

export async function loadReviews(): Promise<{ summary: ReviewSummary; reviews: Review[] }> {
  const body = await request<{ summary?: unknown; reviews?: ApiRow[] }>("/api/reviews", { cache: "no-store" });
  return { summary: mapReviewSummary(body.summary), reviews: Array.isArray(body.reviews) ? body.reviews.map(mapReview) : [] };
}

/** Creates or edits the own review; photos are the ones kept by id plus new prepared files. */
export async function saveOwnReview(input: { rating: number; body: string; files: File[]; keepPhotoIds?: string[] }): Promise<{ created: boolean }> {
  const form = new FormData();
  form.set("rating", String(input.rating)); form.set("body", input.body);
  if (input.keepPhotoIds) form.set("keepPhotoIds", JSON.stringify(input.keepPhotoIds));
  for (const file of input.files) form.append("photos", file, file.name);
  const response = await authFetch("/api/reviews", { method: "POST", body: form }, 90_000);
  const body = await response.json().catch(() => ({})) as { message?: string; created?: boolean };
  if (!response.ok) throw new ApiError(body.message || "Не удалось сохранить отзыв.", response.status);
  return { created: body.created === true };
}

export async function deleteReview(id: string) {
  await request<{ deleted?: boolean }>("/api/reviews/" + encodeURIComponent(id), { method: "DELETE" });
}
