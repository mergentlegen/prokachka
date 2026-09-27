import { getCurrentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { getTaskOrder, saveTaskOrder } from "@/backend/services/task-feed-order.service";

function respond(result: Awaited<ReturnType<typeof getTaskOrder>>) {
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось загрузить или сохранить порядок заданий. Попробуйте ещё раз.", 503);
  if ("forbidden" in result.data) return failure("Недостаточно прав для изменения порядка.", 403);
  if ("conflict" in result.data) return failure("Список изменился. Обновите его и повторите перестановку.", 409);
  if ("invalid" in result.data) return failure("Состав списка изменился или содержит недоступные задания. Обновите список.", 409);
  const response = ok({ order: result.data }); response.headers.set("Cache-Control", "no-store"); return response;
}
export async function taskOrder(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (!user.teamId || (user.role !== "admin" && !user.canPublishTasks)) return failure("Недостаточно прав для изменения порядка.", 403);
  if (request.method === "GET") return respond(await getTaskOrder(user.id));
  const body = await request.json().catch(() => null);
  const validKeys = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 2000
    && value.every((key) => typeof key === "string" && /^(?:[0-9a-f-]{36}|game:[a-z-]{1,50})$/.test(key)) && new Set(value).size === value.length;
  if (!body || typeof body.revision !== "string" || !/^[a-f0-9]{32}$/.test(body.revision)
    || !validKeys(body.pinned) || !validKeys(body.regular) || body.pinned.length + body.regular.length > 2000
    || (body.inherit !== undefined && typeof body.inherit !== "boolean")) return failure("Некорректные данные порядка заданий.", 400);
  return respond(await saveTaskOrder(user.id, body.revision, body.pinned, body.regular, body.inherit === true));
}
