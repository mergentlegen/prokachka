import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { readLimitedFormData } from "@/backend/http/form-data";
import { requestBodyFailure } from "@/backend/http/request-body";
import { getCurrentUser as currentUser } from "@/backend/http/current-user";
import { deleteReview, findReviews, saveReview } from "@/backend/services/reviews.service";
import { scheduleTelegramDelivery } from "@/backend/services/telegram-notifications.service";
import { recordAudit } from "@/backend/services/audit-log.service";

export async function listReviews(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const result = await findReviews(user);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось загрузить отзывы.");
  return ok(result.data);
}

/** The participant's only review: stars, text and photos (kept ones by id plus new files). */
export async function writeReview(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role === "ceo" || !user.teamId) return failure("Отзыв могут оставить участники команды.", 403);
  try {
    const form = await readLimitedFormData(request, 20 * 1024 * 1024);
    const rating = Number(form.get("rating"));
    const body = String(form.get("body") ?? "").trim();
    const files = form.getAll("photos");
    if (files.some((file) => !(file instanceof File))) return failure("Некорректные фотографии.", 400);
    let keepPhotoIds: string[] | undefined;
    const rawKeep = form.get("keepPhotoIds");
    if (rawKeep !== null) {
      const parsed: unknown = JSON.parse(String(rawKeep));
      if (!Array.isArray(parsed) || parsed.length > 6 || parsed.some((id) => typeof id !== "string" || !isUuid(id))) return failure("Некорректные фотографии.", 400);
      keepPhotoIds = parsed as string[];
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return failure("Поставьте оценку от 1 до 5 звёзд.", 400);
    if (body.length < 10 || body.length > 2000) return failure("Напишите отзыв: от 10 до 2000 символов.", 400);
    const result = await saveReview(user, { rating, body, keepPhotoIds, photoFiles: files as File[] });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("validationError" in result) return failure(result.validationError || "Некорректный отзыв.", 400);
    if ("storageError" in result) return failure("Не удалось загрузить фотографию. Попробуйте ещё раз.", 502);
    if ("error" in result) return failure("Не удалось сохранить отзыв.");
    if (result.created) scheduleTelegramDelivery();
    return ok({ review: result.data, created: result.created }, result.created ? 201 : 200);
  } catch (error) {
    return requestBodyFailure(error) || failure("Некорректные данные.", 400);
  }
}

export async function removeReview(request: Request, id: string) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (!isUuid(id)) return failure("Отзыв не найден.", 404);
  const result = await deleteReview(user, id);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось удалить отзыв.");
  if (result.data.notFound) return failure("Отзыв уже удалён.", 404);
  if (result.data.forbidden) return failure("Удалить этот отзыв может автор, его наставник или руководитель команды.", 403);
  // A mentor removing someone's review goes to the leader's journal; authors removing their own do not.
  if (!result.data.own) await recordAudit(user, { action: "review.delete", targetId: id, targetLabel: result.data.authorName, teamId: result.data.teamId ?? null, details: { rating: result.data.rating } });
  return ok({ deleted: true });
}
