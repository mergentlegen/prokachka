import { getCurrentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { deleteTaskAttachment as removeAttachment, getTaskAttachment, uploadTaskAttachment } from "@/backend/services/task-attachments.service";
import { readLimitedFormData } from "@/backend/http/form-data";
import { requestBodyFailure } from "@/backend/http/request-body";

export async function createTaskAttachment(request: Request, taskId: string) {
  if (!isUuid(taskId)) return failure("Некорректное задание.", 400);
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role !== "ceo" && user.role !== "admin" && !user.canPublishTasks) return failure("Недостаточно прав для загрузки файлов.", 403);
  let form: FormData;
  try { form = await readLimitedFormData(request, 16 * 1024 * 1024); }
  catch (error) { return requestBodyFailure(error) || failure("Не удалось прочитать загруженный файл.", 400); }
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

/** Browsers render PDFs with their built-in viewer only without a sandboxing CSP, so the file keeps just the anti-framing rule. */
export const TASK_ATTACHMENT_CSP = "frame-ancestors 'none'";

function isDocumentNavigation(request: Request) {
  const destination = request.headers.get("sec-fetch-dest");
  if (destination) return destination === "document";
  return (request.headers.get("accept") || "").includes("text/html");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

/** A file link opened in a new tab shows a readable page instead of raw JSON when access fails. */
function attachmentFailure(request: Request, message: string, status: number) {
  if (!isDocumentNavigation(request)) return failure(message, status);
  const action = status === 401 ? `<a href="/">Войти в аккаунт</a>` : `<a href="/">Вернуться на сайт</a>`;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Файл недоступен</title><style>body{margin:0;display:grid;min-height:100vh;place-items:center;padding:24px;box-sizing:border-box;background:#f5f8fc;color:#243650;font:16px/1.5 system-ui,sans-serif;text-align:center}main{max-width:420px}h1{margin:0 0 8px;font-size:20px}p{margin:0 0 20px;color:#5d6b82}a{display:inline-block;padding:10px 18px;border-radius:8px;background:#3157a4;color:#fff;text-decoration:none;font-weight:600}</style></head><body><main><h1>Не удалось открыть файл</h1><p>${escapeHtml(message)}</p>${action}</main></body></html>`;
  return new Response(html, { status, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'",
  } });
}

export async function readTaskAttachment(request: Request, taskId: string, attachmentId: string) {
  if (!isUuid(taskId) || !isUuid(attachmentId)) return attachmentFailure(request, "Некорректная ссылка на файл.", 400);
  const user = await getCurrentUser(request);
  if (!user) return attachmentFailure(request, "Сначала войдите в аккаунт, затем откройте файл ещё раз.", 401);
  const result = await getTaskAttachment(taskId, attachmentId, user);
  if ("unavailable" in result) return attachmentFailure(request, "Хранилище не настроено.", 503);
  if ("forbidden" in result) return attachmentFailure(request, "У вас нет доступа к этому файлу, или он был удалён.", 403);
  if ("error" in result) return attachmentFailure(request, "Не удалось загрузить PDF. Попробуйте ещё раз.", 502);
  const { file, attachment } = result.data;
  const download = new URL(request.url).searchParams.get("download") === "1";
  const disposition = download ? "attachment" : "inline";
  const safeFallback = attachment.fileName.replace(/[\r\n"\\]/g, "_").replace(/[^\x20-\x7e]/g, "_");
  return new Response(file, { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `${disposition}; filename="${safeFallback}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    "Content-Length": String(file.size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": TASK_ATTACHMENT_CSP,
  } });
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
