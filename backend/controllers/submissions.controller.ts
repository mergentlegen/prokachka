import { getRequestUser } from "@/backend/http/auth-guard";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { findSubmissionMedia, findSubmissions, insertSubmission, saveReview } from "@/backend/services/submissions.service";
import { serverEnv } from "@/backend/config/env";
import { findAccountById } from "@/backend/services/auth.service";

async function currentUser(request: Request) {
  const sessionUser = getRequestUser(request);
  if (!sessionUser) return null;
  if (sessionUser.id === "ceo") return sessionUser;
  return (await findAccountById(sessionUser.id)) || (process.env.NEXT_PUBLIC_SUPABASE_URL ? null : sessionUser);
}

export async function listSubmissions(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const options = user.role === "member" && !user.canReview ? { userId: user.id } : user.role === "admin" ? { teamId: user.teamId, viewer: user } : user.role === "member" ? { teamId: user.teamId, viewer: user } : {};
  if (user.role === "admin" && !user.teamId) return ok({ submissions: [] });
  const result = await findSubmissions(options);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось загрузить работы.");
  return ok({ submissions: result.data });
}

export async function createSubmission(request: Request) {
  const user = await currentUser(request);
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
  const user = await currentUser(request);
  if (!user || (user.role !== "ceo" && user.role !== "admin" && !user.canReview)) return failure("Недостаточно прав.", user ? 403 : 401);
  try {
    const body = await request.json();
    if (!isUuid(id)) return failure("Некорректная работа.", 400);
    const status = body.status === "accepted" || body.status === "revision" ? body.status : null;
    if (!status) return failure("Неизвестный статус.", 400);
    if (typeof body.comment === "string" && body.comment.length > 4000) return failure("Комментарий слишком длинный.", 400);
    if (body.points !== undefined && (!Number.isFinite(Number(body.points)) || Number(body.points) < 0 || Number(body.points) > 100)) return failure("Некорректное количество баллов.", 400);
    const result = await saveReview(id, { status, points: Math.max(0, Number(body.points) || 0), comment: typeof body.comment === "string" ? body.comment.trim() : "" }, user);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("Работа относится к другой команде.", 403);
    if ("error" in result) return failure("Не удалось сохранить проверку.");
    return ok({ submission: result.data });
  } catch { return failure("Некорректные данные.", 400); }
}

export async function streamSubmissionMedia(request: Request, id: string) {
  const user = await currentUser(request);
  if (!user || (user.role !== "ceo" && user.role !== "admin" && !user.canReview)) return failure("Недостаточно прав.", user ? 403 : 401);
  if (!isUuid(id)) return failure("Некорректная работа.", 400);
  const result = await findSubmissionMedia(id, user);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("forbidden" in result) return failure("Работа относится к другой команде.", 403);
  if ("notFound" in result) return failure("Файл ответа не найден.", 404);
  if (!("data" in result)) return failure("Файл ответа не найден.", 404);
  const media = result.data && typeof result.data === "object" && "fileId" in result.data && "mediaType" in result.data
    ? result.data as { fileId: string; mediaType: string }
    : null;
  if (!media) return failure("Файл ответа не найден.", 404);
  if (!serverEnv.telegramBotToken) return failure("Telegram-бот не настроен.", 503);

  try {
    const fileInfo = await fetch(
      `https://api.telegram.org/bot${serverEnv.telegramBotToken}/getFile?file_id=${encodeURIComponent(media.fileId)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    const filePayload = await fileInfo.json().catch(() => ({})) as { ok?: boolean; result?: { file_path?: string } };
    const filePath = filePayload.result?.file_path;
    if (!fileInfo.ok || !filePayload.ok || !filePath) return failure("Не удалось получить файл ответа.", 502);

    const range = request.headers.get("range");
    const fileResponse = await fetch(
      `https://api.telegram.org/file/bot${serverEnv.telegramBotToken}/${filePath}`,
      { headers: range ? { Range: range } : {}, signal: AbortSignal.timeout(20_000) },
    );
    if (!fileResponse.ok || !fileResponse.body) return failure("Не удалось загрузить файл ответа.", 502);

    const headers = new Headers();
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Type", fileResponse.headers.get("content-type") || mediaContentType(media.mediaType));
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = fileResponse.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(fileResponse.body, { status: fileResponse.status, headers });
  } catch {
    return failure("Не удалось загрузить файл ответа.", 502);
  }
}

function mediaContentType(mediaType: string) {
  if (mediaType === "photo") return "image/jpeg";
  if (mediaType === "video") return "video/mp4";
  return "application/octet-stream";
}
