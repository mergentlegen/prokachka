import { getCurrentUser as currentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { findSubmissionMedia, findSubmissions, findMentorCounts, saveReview } from "@/backend/services/submissions.service";
import { prepareTelegramSubmission } from "@/backend/services/telegram-submission.service";
import { serverEnv } from "@/backend/config/env";


export async function listSubmissions(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const params = new URL(request.url).searchParams;
  if (params.get("summary") === "1") {
    if (user.id === "ceo" || !user.teamId) return ok({ counts: { pending: 0, accepted: 0, requests: 0 } });
    const result = await findMentorCounts(user.id);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure("Не удалось обновить счётчики.");
    return ok({ counts: result.data });
  }
  const requestedUserId = params.get("userId");
  if (requestedUserId && requestedUserId !== user.id) return failure("Недостаточно прав.", 403);
  const personal = params.get("view") === "member" || requestedUserId === user.id || (user.role === "member" && !user.canReview);
  const options = personal ? { userId: user.id } : user.role === "ceo" ? {} : { teamId: user.teamId, viewer: user };
  if (!personal && user.role !== "ceo" && !user.teamId) return ok({ submissions: [] });
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
    const result = await prepareTelegramSubmission(user.id, body.taskId);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("validationError" in result) return failure(result.validationError || "Работу нельзя отправить.", 400);
    if ("error" in result) return failure("Не удалось подготовить отправку работы.");
    return ok({ url: result.url, expiresAt: result.expiresAt }, 201);
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
    if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) return failure("Обновите страницу перед проверкой работы.", 409);
    const result = await saveReview(id, { status, points: Math.max(0, Number(body.points) || 0), comment: typeof body.comment === "string" ? body.comment.trim() : "", expectedVersion: body.expectedVersion }, user);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("Работа относится к другой команде.", 403);
    if ("validationError" in result) return failure(result.validationError || "Работа уже проверена.", 409);
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
    // Never serve participant-controlled HTML/SVG documents as an active same-origin page.
    headers.set("Content-Type", mediaContentType(media.mediaType));
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    if (media.mediaType === "document") headers.set("Content-Disposition", 'attachment; filename="answer"');
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
