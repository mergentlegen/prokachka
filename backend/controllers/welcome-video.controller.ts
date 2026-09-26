import { getCurrentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { completeWelcomeVideo, createWelcomeVideoUpload, deleteWelcomeVideo, finishWelcomeVideoUpload, getWelcomeVideo, getWelcomeVideoSettings } from "@/backend/services/welcome-video.service";
import type { AuthUser } from "@/shared/domain/types";

async function authenticated(request: Request): Promise<AuthUser | Response> {
  const user = await getCurrentUser(request);
  return user || failure("Сначала войдите в аккаунт.", 401);
}
function isResponse(value: AuthUser | Response): value is Response { return value instanceof Response; }
function resultResponse(result: Record<string, unknown>) {
  if ("unavailable" in result) return failure("Хранилище или база данных пока не настроены.", 503);
  if ("forbidden" in result) return failure("Недостаточно прав для этого действия.", 403);
  if ("validationError" in result) return failure(String(result.validationError), 400);
  if ("storageError" in result) return failure("Не удалось обратиться к закрытому хранилищу видео.", 502);
  if ("error" in result) return failure("Не удалось сохранить настройки приветственного видео.");
  return ok("data" in result ? result.data : result);
}

export async function readWelcomeVideo(request: Request) {
  const user = await authenticated(request);
  if (isResponse(user)) return user;
  const result = await getWelcomeVideo(user);
  if ("unavailable" in result) return failure("База данных пока не настроена.", 503);
  if ("error" in result) return failure("Не удалось загрузить приветственное видео.", 502);
  return ok(result.data);
}

export async function markWelcomeVideoComplete(request: Request) {
  const user = await authenticated(request);
  if (isResponse(user)) return user;
  const result = await completeWelcomeVideo(user);
  if ("unavailable" in result) return failure("База данных пока не настроена.", 503);
  if ("forbidden" in result) return failure("Нет активного членства в команде.", 403);
  if ("error" in result) return failure("Не удалось сохранить просмотр. Попробуйте ещё раз.", 502);
  return ok({ completed: true });
}

export async function readWelcomeVideoSettings(request: Request) {
  const user = await authenticated(request);
  if (isResponse(user)) return user;
  return resultResponse(await getWelcomeVideoSettings(user));
}

export async function requestWelcomeVideoUpload(request: Request) {
  const user = await authenticated(request);
  if (isResponse(user)) return user;
  try {
    const body = await request.json();
    return resultResponse(await createWelcomeVideoUpload(user, body.metadata));
  } catch { return failure("Не удалось прочитать данные загрузки.", 400); }
}

export async function finishWelcomeVideo(request: Request) {
  const user = await authenticated(request);
  if (isResponse(user)) return user;
  try {
    const body = await request.json();
    return resultResponse(await finishWelcomeVideoUpload(user, body.path, body.metadata));
  } catch { return failure("Не удалось проверить загруженный файл.", 400); }
}

export async function removeWelcomeVideo(request: Request) {
  const user = await authenticated(request);
  if (isResponse(user)) return user;
  return resultResponse(await deleteWelcomeVideo(user));
}
