import { failure, ok } from "@/backend/http/api-response";
import { isUuid, parseExternalUrl } from "@/backend/http/security";
import { getRequestUser } from "@/backend/http/auth-guard";
import { findAccountById } from "@/backend/services/auth.service";
import {
  findAnnouncements,
  insertAnnouncement,
  patchAnnouncement,
  removeAnnouncement,
} from "@/backend/services/announcements.service";

async function currentUser(request: Request) {
  const sessionUser = getRequestUser(request);
  if (!sessionUser) return null;
  if (sessionUser.id === "ceo") return sessionUser;
  return (await findAccountById(sessionUser.id)) || (process.env.NEXT_PUBLIC_SUPABASE_URL ? null : sessionUser);
}

function validateText(value: unknown, min: number, max: number) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

export async function listAnnouncements(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);

  const teamId = user.role === "member" || user.role === "admin" ? user.teamId : undefined;
  if ((user.role === "member" || user.role === "admin") && !teamId) {
    return ok({ announcements: [] });
  }

  const result = await findAnnouncements({
    teamId,
    includeInactive: user.role !== "member",
    viewer: user,
  });
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось загрузить объявления.");
  return ok({ announcements: result.data });
}

export async function createAnnouncement(request: Request) {
  const user = await currentUser(request);
  if (!user || (user.role !== "admin" && !(user.role === "member" && user.canPublishTasks))) {
    return failure("Только наставник может публиковать объявления.", user ? 403 : 401);
  }

  if (!user.teamId) return failure("Сначала назначьте команду.", 400);

  try {
    const body = await request.json();
    if (!validateText(body.title, 2, 160)) {
      return failure("Заголовок должен содержать от 2 до 160 символов.", 400);
    }
    if (!validateText(body.content, 2, 5000)) {
      return failure("Текст должен содержать от 2 до 5000 символов.", 400);
    }

    const resourceUrl = parseExternalUrl(body.resourceUrl);
    if ("error" in resourceUrl) return failure(resourceUrl.error, 400);
    const result = await insertAnnouncement({
      teamId: user.teamId,
      authorId: user.id,
      title: body.title.trim(),
      content: body.content.trim(),
      resourceUrl: resourceUrl.value,
      audienceRootId: user.role === "member" ? user.id : null,
    });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure("Не удалось создать объявление.");
    return ok({ announcement: result.data }, 201);
  } catch {
    return failure("Некорректные данные.", 400);
  }
}

export async function updateAnnouncement(request: Request, id: string) {
  const user = await currentUser(request);
  if (!isUuid(id)) return failure("Некорректное объявление.", 400);
  if (!user || (user.role !== "ceo" && user.role !== "admin" && !user.canPublishTasks)) return failure("Недостаточно прав.", user ? 403 : 401);
  if (user.role !== "ceo" && !user.teamId) return failure("Сначала назначьте команду.", 400);

  try {
    const body = await request.json();
    if (body.title !== undefined && !validateText(body.title, 2, 160)) {
      return failure("Заголовок должен содержать от 2 до 160 символов.", 400);
    }
    if (body.content !== undefined && !validateText(body.content, 2, 5000)) {
      return failure("Текст должен содержать от 2 до 5000 символов.", 400);
    }
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
      return failure("Некорректный статус объявления.", 400);
    }

    const resourceUrl = Object.prototype.hasOwnProperty.call(body, "resourceUrl") ? parseExternalUrl(body.resourceUrl) : { value: undefined as string | null | undefined };
    if ("error" in resourceUrl) return failure(resourceUrl.error, 400);
    const result = await patchAnnouncement(
      id,
      {
        title: body.title === undefined ? undefined : body.title.trim(),
        content: body.content === undefined ? undefined : body.content.trim(),
        resourceUrl: Object.prototype.hasOwnProperty.call(body, "resourceUrl") ? resourceUrl.value : undefined,
        isActive: body.isActive,
      },
      user,
    );
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("У вас нет доступа к этому объявлению.", 403);
    if (result.error) return failure("Не удалось изменить объявление.");
    return ok({ announcement: result.data });
  } catch {
    return failure("Некорректные данные.", 400);
  }
}

export async function deleteAnnouncement(request: Request, id: string) {
  const user = await currentUser(request);
  if (!isUuid(id)) return failure("Некорректное объявление.", 400);
  if (!user || (user.role !== "ceo" && user.role !== "admin" && !user.canPublishTasks)) return failure("Недостаточно прав.", user ? 403 : 401);
  if (user.role !== "ceo" && !user.teamId) return failure("Сначала назначьте команду.", 400);

  const result = await removeAnnouncement(id, user);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("forbidden" in result) return failure("У вас нет доступа к этому объявлению.", 403);
  if (result.error) return failure("Не удалось удалить объявление.");
  return ok({});
}
