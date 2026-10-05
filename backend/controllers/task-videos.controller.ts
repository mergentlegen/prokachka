import { getCurrentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { auditRecord, recordAudit } from "@/backend/services/audit-log.service";
import { beginTaskVideoUpload, finishTaskVideoUpload, getTaskVideo, recordTaskVideoProgress, removeTaskVideo } from "@/backend/services/task-videos.service";

async function signedIn(request: Request, taskId: string) {
  if (!isUuid(taskId)) return { response: failure("Некорректное задание.", 400) };
  const user = await getCurrentUser(request);
  if (!user) return { response: failure("Сначала войдите в аккаунт.", 401) };
  return { user };
}

export async function readTaskVideo(request: Request, taskId: string) {
  const { user, response } = await signedIn(request, taskId);
  if (!user) return response;
  const result = await getTaskVideo(user, taskId);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("notFound" in result) return failure("У задания нет видео.", 404);
  if ("forbidden" in result) return failure("Видео недоступно.", 403);
  if ("error" in result) return failure("Не удалось открыть видео. Попробуйте ещё раз.", 503);
  return ok({ video: result.data });
}

export async function saveTaskVideoProgress(request: Request, taskId: string) {
  const { user, response } = await signedIn(request, taskId);
  if (!user) return response;
  if (user.role !== "member") return ok({ progress: null });
  try {
    const body = await readLimitedJson(request);
    const position = Number(body.position);
    if (!Number.isFinite(position) || position < 0 || position > 24 * 3600) return failure("Некорректная позиция видео.", 400);
    const result = await recordTaskVideoProgress(user, taskId, position);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result || "notFound" in result) return failure("Видео недоступно.", 403);
    if ("error" in result) return failure("Не удалось сохранить просмотр.", 503);
    return ok({ progress: result.data });
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

export async function startTaskVideoUpload(request: Request, taskId: string) {
  const { user, response } = await signedIn(request, taskId);
  if (!user) return response;
  try {
    const body = await readLimitedJson(request);
    const result = await beginTaskVideoUpload(user, taskId, { fileName: body.fileName, sizeBytes: body.sizeBytes, contentType: body.contentType });
    if ("unavailable" in result) return failure("Загрузка видео не настроена.", 503);
    if ("validationError" in result) return failure(result.validationError || "Некорректное видео.", 400);
    if ("forbidden" in result) return failure("Добавлять видео может автор задания или руководитель команды.", 403);
    if ("storageError" in result || "error" in result) return failure("Хранилище не приняло загрузку. Попробуйте ещё раз.", 502);
    return ok({ upload: result.data });
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

export async function completeTaskVideoUpload(request: Request, taskId: string) {
  const { user, response } = await signedIn(request, taskId);
  if (!user) return response;
  try {
    const body = await readLimitedJson(request);
    const result = await finishTaskVideoUpload(user, taskId, { path: body.path, fileName: body.fileName, sizeBytes: body.sizeBytes });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("validationError" in result) return failure(result.validationError || "Некорректное видео.", 400);
    if ("forbidden" in result) return failure("Добавлять видео может автор задания или руководитель команды.", 403);
    if ("error" in result) return failure("Не удалось сохранить видео. Попробуйте ещё раз.", 503);
    const task = await auditRecord("tasks", taskId);
    await recordAudit(user, { action: "task.video", targetId: taskId, targetLabel: task?.label, teamId: task?.teamId });
    return ok({ saved: true }, 201);
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

export async function deleteTaskVideo(request: Request, taskId: string) {
  const { user, response } = await signedIn(request, taskId);
  if (!user) return response;
  const result = await removeTaskVideo(user, taskId);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("forbidden" in result) return failure("Удалять видео может автор задания или руководитель команды.", 403);
  if ("error" in result) return failure("Не удалось удалить видео.", 503);
  return ok({});
}
