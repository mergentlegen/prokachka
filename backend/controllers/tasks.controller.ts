import { getRequestUser } from "@/backend/http/auth-guard";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid, parseExternalUrl } from "@/backend/http/security";
import { findAccountById } from "@/backend/services/auth.service";
import { getMemberTaskFeed } from "@/backend/services/member-progress.service";
import { deleteTask as deleteTaskRecord, findTasks, insertTask, patchTask } from "@/backend/services/tasks.service";

async function currentUser(request: Request) {
  const sessionUser = getRequestUser(request);
  if (!sessionUser) return null;
  if (sessionUser.id === "ceo") return sessionUser;
  return (await findAccountById(sessionUser.id)) || (process.env.NEXT_PUBLIC_SUPABASE_URL ? null : sessionUser);
}

function canPublish(user: Awaited<ReturnType<typeof currentUser>>) {
  return Boolean(user && (user.role === "ceo" || user.role === "admin" || user.canPublishTasks));
}

function parseDeadline(value: unknown) {
  if (value === undefined || value === null || value === "") return { value: null as string | null };
  if (typeof value !== "string") return { error: "Дедлайн указан некорректно." };
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return { error: "Дедлайн указан некорректно." };
  return { value: new Date(timestamp).toISOString() };
}

export async function listTasks(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const memberView = new URL(request.url).searchParams.get("view") === "member";
  if (user.role === "member" && (memberView || (!user.canReview && !user.canPublishTasks))) {
    const teamId = user.teamId;
    if (!teamId) return ok({ tasks: [] });
    const result = await getMemberTaskFeed(user.id, teamId, user.teamJoinedAt);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("error" in result) return failure("Не удалось загрузить задания.");
    return ok({ tasks: result.data });
  }
  if ((user.role === "admin" || user.role === "member") && !user.teamId) return ok({ tasks: [] });
  const result = await findTasks(user.role === "ceo" ? undefined : user.teamId, user);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось загрузить задания.");
  return ok({ tasks: result.data });
}

export async function createTask(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Недостаточно прав.", 401);
  if (!canPublish(user)) return failure("Недостаточно прав для публикации заданий.", 403);
  try {
    const body = await request.json();
    if (typeof body.title !== "string" || typeof body.description !== "string" || body.title.trim().length < 2 || body.description.trim().length < 2) return failure("Заполните название и описание.", 400);
    if (body.title.trim().length > 160 || body.description.trim().length > 5000) return failure("Название или описание слишком длинные.", 400);
    const deadline = parseDeadline(body.deadlineAt);
    if (deadline.error) return failure(deadline.error, 400);
    const resourceUrl = parseExternalUrl(body.resourceUrl);
    if ("error" in resourceUrl) return failure(resourceUrl.error, 400);
    const teamId = user.role === "ceo" ? typeof body.teamId === "string" ? body.teamId : undefined : user.teamId;
    if (teamId && !isUuid(teamId)) return failure("Некорректная команда.", 400);
    if (body.maxPoints !== undefined && (!Number.isFinite(Number(body.maxPoints)) || Number(body.maxPoints) < 0 || Number(body.maxPoints) > 100)) return failure("Некорректное количество баллов.", 400);
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") return failure("Некорректный статус задания.", 400);
    if (body.publicationType !== undefined && !["evergreen", "fixed", "sequential"].includes(body.publicationType)) return failure("Некорректный тип публикации.", 400);
    const result = await insertTask({
      title: body.title.trim(), description: body.description.trim(), maxPoints: body.maxPoints, deadlineAt: deadline.value,
      isActive: body.isActive, teamId, publicationType: body.publicationType, programId: body.programId,
      position: body.position, deadlineHours: body.deadlineHours, resourceUrl: resourceUrl.value,
      publisherId: user.id === "ceo" ? undefined : user.id,
      audienceRootId: user.role === "member" ? user.id : null,
    });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("Нельзя добавить задание в чужую программу.", 403);
    if ("validationError" in result) return failure(result.validationError || "Выберите команду.", 400);
    if (result.error) return failure("Не удалось создать задание.");
    return ok({ task: result.data }, 201);
  } catch { return failure("Некорректные данные.", 400); }
}

export async function updateTask(request: Request, id: string) {
  const user = await currentUser(request);
  if (!isUuid(id)) return failure("Некорректное задание.", 400);
  if (!user) return failure("Недостаточно прав.", 401);
  if (!canPublish(user)) return failure("Недостаточно прав для изменения заданий.", 403);
  try {
    const body = await request.json();
    if (body.title !== undefined && (typeof body.title !== "string" || body.title.trim().length < 2 || body.title.trim().length > 160)) return failure("Название задания должно быть от 2 до 160 символов.", 400);
    if (body.description !== undefined && (typeof body.description !== "string" || body.description.trim().length < 2 || body.description.trim().length > 5000)) return failure("Описание задания должно быть от 2 до 5000 символов.", 400);
    if (body.maxPoints !== undefined && (!Number.isFinite(Number(body.maxPoints)) || Number(body.maxPoints) < 0 || Number(body.maxPoints) > 100)) return failure("Некорректное количество баллов.", 400);
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") return failure("Некорректный статус задания.", 400);
    const deadline = Object.prototype.hasOwnProperty.call(body, "deadlineAt") ? parseDeadline(body.deadlineAt) : { value: undefined as string | null | undefined };
    if ("error" in deadline) return failure(deadline.error, 400);
    const resourceUrl = Object.prototype.hasOwnProperty.call(body, "resourceUrl") ? parseExternalUrl(body.resourceUrl) : { value: undefined as string | null | undefined };
    if ("error" in resourceUrl) return failure(resourceUrl.error, 400);
    const input: Record<string, unknown> = { ...body };
    if (Object.prototype.hasOwnProperty.call(body, "deadlineAt")) input.deadlineAt = deadline.value;
    if (Object.prototype.hasOwnProperty.call(body, "resourceUrl")) input.resourceUrl = resourceUrl.value;
    const result = await patchTask(id, input, user);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("У вас нет доступа к этому заданию.", 403);
    if (result.error) return failure("Не удалось обновить задание.");
    return ok({ task: result.data });
  } catch { return failure("Некорректные данные.", 400); }
}

export async function deleteTask(request: Request, id: string) {
  const user = await currentUser(request);
  if (!isUuid(id)) return failure("Некорректное задание.", 400);
  if (!user) return failure("Недостаточно прав.", 401);
  if (!canPublish(user)) return failure("Недостаточно прав для удаления заданий.", 403);
  if (user.role !== "ceo" && !user.teamId) return failure("За пользователем не закреплена команда.", 403);
  const result = await deleteTaskRecord(id, user);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("forbidden" in result) return failure("У вас нет доступа к этому заданию.", 403);
  if (result.error) return failure("Не удалось удалить задание.");
  return ok({});
}
