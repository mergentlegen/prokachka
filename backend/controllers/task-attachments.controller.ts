import { getCurrentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { deleteTaskAttachment as removeAttachment, getTaskAttachment, uploadTaskAttachment } from "@/backend/services/task-attachments.service";

export async function createTaskAttachment(request: Request, taskId: string) {
  if (!isUuid(taskId)) return failure("Некорректное задание.", 400);
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  let form: FormData;
  try { form = await request.formData(); } catch { return failure("Не удалось прочитать загруженный файл.", 400); }
  const file = form.get("file");
  if (!(file instanceof File)) return failure("Выберите PDF-файл для загрузки.", 400);
  const result = await uploadTaskAttachment(taskId, user, file);
  if ("unavailable" in result) return failure("Хранилище не настроено.", 503);
  if ("forbidden" in result) return failure("У вас нет доступа к этому заданию.", 403);
  if ("validationError" in result) return failure(result.validationError || "Недопустимый PDF-файл.", 400);
  if ("storageError" in result) return failure("Не удалось сохранить файл. Проверьте настройки закрытого хранилища.", 502);
  if ("error" in result) return failure("Не удалось сохранить вложение.");
  return ok({ attachment: { id: result.data.id, file_name: result.data.fileName, content_type: result.data.contentType, size_bytes: result.data.sizeBytes, created_at: result.data.createdAt } }, 201);
}

export async function readTaskAttachment(request: Request, taskId: string, attachmentId: string) {
  if (!isUuid(taskId) || !isUuid(attachmentId)) return failure("Некорректное вложение.", 400);
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const result = await getTaskAttachment(taskId, attachmentId, user);
  if ("unavailable" in result) return failure("Хранилище не настроено.", 503);
  if ("forbidden" in result) return failure("У вас нет доступа к этому файлу.", 403);
  if ("error" in result) return failure("Не удалось открыть PDF.", 502);
  const { file, attachment } = result.data;
  const download = new URL(request.url).searchParams.get("download") === "1";
  const disposition = download ? "attachment" : "inline";
  const safeFallback = attachment.fileName.replace(/[\r\n"\\]/g, "_").replace(/[^\x20-\x7e]/g, "_");
  const response = new Response(await file.arrayBuffer(), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `${disposition}; filename="${safeFallback}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    "Content-Length": String(attachment.sizeBytes), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  } });
  return response;
}

export async function removeTaskAttachment(request: Request, taskId: string, attachmentId: string) {
  if (!isUuid(taskId) || !isUuid(attachmentId)) return failure("Некорректное вложение.", 400);
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const result = await removeAttachment(taskId, attachmentId, user);
  if ("unavailable" in result) return failure("Хранилище не настроено.", 503);
  if ("forbidden" in result) return failure("У вас нет доступа к этому файлу.", 403);
  if ("error" in result) return failure("Не удалось удалить вложение.");
  return ok({ storageCleanupWarning: result.storageCleanupWarning });
}
