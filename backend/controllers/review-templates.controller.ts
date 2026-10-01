import { failure, ok } from "@/backend/http/api-response";
import { getCurrentUser } from "@/backend/http/current-user";
import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { findReviewTemplates, replaceReviewTemplates, REVIEW_TEMPLATE_LIMIT, REVIEW_TEMPLATE_MAX_LENGTH } from "@/backend/services/review-templates.service";

// Everyone who reviews work in the team reads the shared comments; only the team leader edits them.
export async function listReviewTemplates(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (!user.teamId || !(user.role === "admin" || (user.role === "member" && user.canReview))) return failure("Недостаточно прав.", 403);
  const result = await findReviewTemplates(user.teamId);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось загрузить готовые комментарии.");
  return ok({ templates: result.data, canEdit: user.role === "admin" });
}

export async function saveReviewTemplates(request: Request) {
  const user = await getCurrentUser(request);
  if (!user || user.role !== "admin") return failure("Готовые комментарии меняет руководитель команды.", user ? 403 : 401);
  try {
    const body = await readLimitedJson(request);
    const templates = body.templates;
    if (!Array.isArray(templates) || templates.length > REVIEW_TEMPLATE_LIMIT * 2 || templates.some((item) => typeof item !== "string" || item.length > REVIEW_TEMPLATE_MAX_LENGTH * 2)) {
      return failure("Некорректный список комментариев.", 400);
    }
    const result = await replaceReviewTemplates(user.id, templates);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("Готовые комментарии меняет руководитель команды.", 403);
    if ("validationError" in result) return failure(result.validationError || "Некорректные данные.", 400);
    if ("error" in result) return failure("Не удалось сохранить готовые комментарии.");
    return ok({ templates: result.data, canEdit: true });
  } catch (error) {
    return requestBodyFailure(error) || failure("Некорректные данные.", 400);
  }
}
