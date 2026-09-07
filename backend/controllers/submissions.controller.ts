import { getRequestUser, hasRole } from "@/backend/http/auth-guard";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { findSubmissions, insertSubmission, saveReview } from "@/backend/services/submissions.service";

export async function listSubmissions(request: Request) {
  const user = getRequestUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const options = user.role === "member" ? { userId: user.id } : user.role === "admin" ? { teamId: user.teamId } : {};
  if (user.role === "admin" && !user.teamId) return ok({ submissions: [] });
  const result = await findSubmissions(options);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось загрузить работы.");
  return ok({ submissions: result.data });
}

export async function createSubmission(request: Request) {
  const user = getRequestUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role !== "member") return failure("Работу может отправить только участник.", 403);
  try {
    const body = await request.json();
    if (!isUuid(body.taskId)) return failure("Некорректное задание.", 400);
    const result = await insertSubmission({ userId: user.id, taskId: body.taskId, telegramChatId: body.telegramChatId ? String(body.telegramChatId) : undefined, telegramMessageId: body.telegramMessageId ? String(body.telegramMessageId) : undefined });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("validationError" in result) return failure(result.validationError || "Работу нельзя отправить.", 400);
    if (result.error) return failure("Не удалось создать работу.");
    return ok({ submission: result.data }, 201);
  } catch { return failure("Некорректные данные.", 400); }
}

export async function reviewSubmission(request: Request, id: string) {
  const user = getRequestUser(request);
  if (!user || !hasRole(user, ["ceo", "admin"])) return failure("Недостаточно прав.", user ? 403 : 401);
  try {
    const body = await request.json();
    if (!isUuid(id)) return failure("Некорректная работа.", 400);
    const status = body.status === "accepted" || body.status === "revision" ? body.status : null;
    if (!status) return failure("Неизвестный статус.", 400);
    if (typeof body.comment === "string" && body.comment.length > 4000) return failure("Комментарий слишком длинный.", 400);
    if (body.points !== undefined && (!Number.isFinite(Number(body.points)) || Number(body.points) < 0 || Number(body.points) > 100)) return failure("Некорректное количество баллов.", 400);
    const result = await saveReview(id, { status, points: Math.max(0, Number(body.points) || 0), comment: typeof body.comment === "string" ? body.comment.trim() : "" }, user.role === "admin" ? user.teamId : undefined);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("Работа относится к другой команде.", 403);
    if (result.error) return failure("Не удалось сохранить проверку.");
    return ok({ submission: result.data });
  } catch { return failure("Некорректные данные.", 400); }
}