import { getCurrentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { enforceRateLimit, isUuid } from "@/backend/http/security";
import { createSession, findAccountById } from "@/backend/services/auth.service";
import { normalizeAvatar, saveOwnProfile } from "@/backend/services/profile.service";
import { AVATAR_UPLOAD_MAX_BYTES, validateProfileNames } from "@/shared/domain/profile";
import { serverEnv } from "@/backend/config/env";
import { sessionCookie } from "@/backend/http/session-cookie";
import { FormDataLimitError, readLimitedFormData } from "@/backend/http/form-data";

export async function updateOwnProfile(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (!isUuid(user.id)) return failure("Для этого системного аккаунта редактирование профиля недоступно.", 403);
  const blocked = enforceRateLimit(`profile:${user.id}`, 10, 60_000);
  if (blocked) return blocked;
  let form: FormData;
  try { form = await readLimitedFormData(request, 768 * 1024); }
  catch (error) { return failure(error instanceof FormDataLimitError ? "Фотография слишком большая." : "Не удалось прочитать данные профиля.", error instanceof FormDataLimitError ? 413 : 400); }
  const names = validateProfileNames(form.get("firstName"), form.get("lastName"));
  if ("error" in names) return failure(names.error, 400);
  const action = form.get("avatarAction"), version = form.get("expectedVersion");
  if (action !== "keep" && action !== "replace" && action !== "remove") return failure("Некорректное действие с фотографией.", 400);
  if (typeof version !== "string" || version.length > 40 || !Number.isFinite(Date.parse(version))) return failure("Обновите профиль и попробуйте снова.", 409);
  const file = form.get("avatar");
  if (action !== "replace" && file !== null) return failure("Некорректные данные фотографии.", 400);
  let avatar: Buffer | undefined;
  if (action === "replace") {
    if (!(file instanceof File) || !file.size || file.size > AVATAR_UPLOAD_MAX_BYTES) return failure("Фотография слишком большая. Выберите файл ещё раз.", 413);
    try { avatar = await normalizeAvatar(new Uint8Array(await file.arrayBuffer())); }
    catch { return failure("Не удалось обработать фото. Выберите изображение JPG, PNG или WebP.", 400); }
  }
  const result = await saveOwnProfile(user.id, { ...names, expectedVersion: version, avatarAction: action, avatar });
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("conflict" in result) return failure("Профиль уже изменён в другом окне. Обновите данные и повторите сохранение.", 409);
  if ("storageError" in result) return failure("Не удалось загрузить фотографию. Попробуйте ещё раз.", 502);
  if ("error" in result) return failure("Не удалось сохранить профиль. Попробуйте ещё раз.", 500);
  const updated = await findAccountById(user.id);
  if (!updated) return failure("Профиль сохранён, но не удалось обновить данные. Обновите страницу.", 503);
  const session = createSession(updated);
  const response = ok({ user: updated, ...(serverEnv.authDevMode ? { session } : {}) });
  if (!serverEnv.authDevMode) response.headers.set("Set-Cookie", sessionCookie(session));
  return response;
}
