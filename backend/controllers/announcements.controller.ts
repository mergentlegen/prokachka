import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid, parseExternalUrl } from "@/backend/http/security";
import { readLimitedFormData } from "@/backend/http/form-data";
import { getCurrentUser as currentUser } from "@/backend/http/current-user";
import {
  findAnnouncements,
  insertAnnouncement,
  patchAnnouncement,
  removeAnnouncement,
} from "@/backend/services/announcements.service";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { scheduleTelegramDelivery } from "@/backend/services/telegram-notifications.service";
import { auditRecord, recordAudit } from "@/backend/services/audit-log.service";

/** Queues the announcement for the participants who see it; returns how many messages will go out. */
async function queueAnnouncementTelegram(actorId: string, announcementId: string) {
  try {
    const result = await getSupabaseAdmin()?.rpc("app_queue_announcement", { p_actor: actorId, p_announcement: announcementId });
    if (!result || result.error) return null;
    scheduleTelegramDelivery();
    return Number(result.data || 0);
  } catch { return null; }
}


function validateText(value: unknown, min: number, max: number) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

async function readAnnouncementBody(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data"))
    return { body: await readLimitedJson(request), photoFiles: [] as File[], keepPhotoIds: undefined as string[] | undefined };
  const form = await readLimitedFormData(request, 20 * 1024 * 1024);
  const photoFiles = form.getAll("photos");
  if (photoFiles.some((file) => !(file instanceof File))) throw new Error("invalid_photos");
  const rawKeep = form.get("keepPhotoIds");
  let keepPhotoIds: string[] | undefined;
  if (rawKeep !== null) {
    const parsed: unknown = JSON.parse(String(rawKeep));
    if (!Array.isArray(parsed) || parsed.length > 6 || parsed.some((id) => !isUuid(id))) throw new Error("invalid_photos");
    keepPhotoIds = parsed;
  }
  return {
    body: { title: form.get("title"), content: form.get("content"), resourceUrl: form.get("resourceUrl"), notifyTelegram: form.get("notifyTelegram") === "true" },
    photoFiles: photoFiles as File[], keepPhotoIds,
  };
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
    const { body, photoFiles } = await readAnnouncementBody(request);
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
      photoFiles,
    });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("validationError" in result) return failure(result.validationError || "Некорректная фотография.", 400);
    if ("storageError" in result) return failure("Не удалось загрузить фотографию в Storage.", 502);
    if ("error" in result && result.error) return failure("Не удалось создать объявление.");
    const announcementId = String(result.data?.id || "");
    // The announcement is already published; a Telegram problem only changes the message shown to the mentor.
    const telegramQueued = body.notifyTelegram === true && announcementId ? await queueAnnouncementTelegram(user.id, announcementId) : undefined;
    await recordAudit(user, { action: "announcement.create", targetId: announcementId, targetLabel: body.title.trim(), teamId: user.teamId, details: telegramQueued === undefined ? {} : { telegram: telegramQueued ?? 0 } });
    return ok({ announcement: result.data, telegramQueued: telegramQueued === undefined ? undefined : telegramQueued ?? -1 }, 201);
  } catch (error) {
    return requestBodyFailure(error) || failure("Некорректные данные.", 400);
  }
}

export async function updateAnnouncement(request: Request, id: string) {
  const user = await currentUser(request);
  if (!isUuid(id)) return failure("Некорректное объявление.", 400);
  if (!user || (user.role !== "ceo" && user.role !== "admin" && !user.canPublishTasks)) return failure("Недостаточно прав.", user ? 403 : 401);
  if (user.role !== "ceo" && !user.teamId) return failure("Сначала назначьте команду.", 400);

  try {
    const { body, photoFiles, keepPhotoIds } = await readAnnouncementBody(request);
    if (body.title !== undefined && !validateText(body.title, 2, 160)) {
      return failure("Заголовок должен содержать от 2 до 160 символов.", 400);
    }
    if (body.content !== undefined && !validateText(body.content, 2, 5000)) {
      return failure("Текст должен содержать от 2 до 5000 символов.", 400);
    }
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
      return failure("Некорректный статус объявления.", 400);
    }

    if (body.isPinned !== undefined && typeof body.isPinned !== "boolean") return failure("Некорректный статус закрепления.", 400);
    const resourceUrl = Object.prototype.hasOwnProperty.call(body, "resourceUrl") ? parseExternalUrl(body.resourceUrl) : { value: undefined as string | null | undefined };
    if ("error" in resourceUrl) return failure(resourceUrl.error, 400);
    const result = await patchAnnouncement(
      id,
      {
        title: body.title === undefined ? undefined : body.title.trim(),
        content: body.content === undefined ? undefined : body.content.trim(),
        resourceUrl: Object.prototype.hasOwnProperty.call(body, "resourceUrl") ? resourceUrl.value : undefined,
        isActive: body.isActive,
        isPinned: body.isPinned,
        photoFiles,
        keepPhotoIds,
      },
      user,
    );
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("У вас нет доступа к этому объявлению.", 403);
    if ("validationError" in result) return failure(result.validationError || "Некорректная фотография.", 400);
    if ("storageError" in result) return failure("Не удалось загрузить фотографию в Storage.", 502);
    if ("error" in result && result.error) return failure("Не удалось изменить объявление.");
    return ok({ announcement: result.data });
  } catch (error) {
    return requestBodyFailure(error) || failure("Некорректные данные.", 400);
  }
}

export async function deleteAnnouncement(request: Request, id: string) {
  const user = await currentUser(request);
  if (!isUuid(id)) return failure("Некорректное объявление.", 400);
  if (!user || (user.role !== "ceo" && user.role !== "admin" && !user.canPublishTasks)) return failure("Недостаточно прав.", user ? 403 : 401);
  if (user.role !== "ceo" && !user.teamId) return failure("Сначала назначьте команду.", 400);

  const before = await auditRecord("announcements", id);
  const result = await removeAnnouncement(id, user);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("forbidden" in result) return failure("У вас нет доступа к этому объявлению.", 403);
  if (result.error) return failure("Не удалось удалить объявление.");
  await recordAudit(user, { action: "announcement.delete", targetId: id, targetLabel: before?.label, teamId: before?.teamId });
  return ok({});
}
