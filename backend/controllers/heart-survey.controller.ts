import { failure, ok } from "@/backend/http/api-response";
import { getCurrentUser } from "@/backend/http/current-user";
import { isUuid } from "@/backend/http/security";
import { saveHeartSurvey } from "@/backend/services/heart-survey.service";
import { scheduleTelegramDelivery } from "@/backend/services/telegram-notifications.service";

export async function postHeartSurvey(request: Request, taskId: string) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role !== "member") return failure("Опросник доступен участникам.", 403);
  if (!isUuid(taskId)) return failure("Некорректный опросник.", 400);
  let body: { action?: unknown; answer?: unknown; questionIndex?: unknown };
  try { body = await request.json(); } catch { return failure("Некорректные данные.", 400); }
  if (!body || (body.action !== "start" && body.action !== "answer")) return failure("Неизвестное действие опросника.", 400);
  if (body.action === "answer" && (!Number.isInteger(body.answer) || Number(body.answer) < 0 || Number(body.answer) > 4 || !Number.isInteger(body.questionIndex) || Number(body.questionIndex) < 0 || Number(body.questionIndex) > 4)) return failure("Выберите ответ на текущий вопрос.", 400);
  const result = await saveHeartSurvey(user.id, taskId, body.action, body.action === "answer" ? Number(body.answer) : undefined, body.action === "answer" ? Number(body.questionIndex) : undefined);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось сохранить ответ. Попробуйте ещё раз.");
  if ("validationError" in result) return failure(result.validationError!, 409);
  if (result.data?.completed) scheduleTelegramDelivery();
  return ok({ survey: result.data });
}
