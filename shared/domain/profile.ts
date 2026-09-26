export const AVATAR_BUCKET = "profile-avatars";
export const AVATAR_INPUT_MAX_BYTES = 25 * 1024 * 1024;
export const AVATAR_UPLOAD_MAX_BYTES = 512 * 1024;
export const AVATAR_STORED_MAX_BYTES = 256 * 1024;
export const AVATAR_SIZE = 512;
// Advertised 24/48 MP phone images can slightly exceed 24/48 million pixels.
export const AVATAR_INPUT_MAX_PIXELS = 60_000_000;
export const AVATAR_PREVIEW_MAX_EDGE = 2048;
export const AVATAR_FILE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";

export function validateProfileNames(firstName: unknown, lastName: unknown): { error: string } | { firstName: string; lastName: string } {
  const normalize = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  const first = normalize(firstName), last = normalize(lastName);
  const unsafe = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u;
  if (unsafe.test(String(firstName)) || unsafe.test(String(lastName))) return { error: "Уберите служебные символы из имени и фамилии." };
  if (first.length < 2 || first.length > 60) return { error: "Имя должно содержать от 2 до 60 символов." };
  if (last.length < 2 || last.length > 80) return { error: "Фамилия должна содержать от 2 до 80 символов." };
  return { firstName: first, lastName: last };
}

export function profileNames(user: { name: string; firstName?: string; lastName?: string }) {
  const [first = "", ...rest] = user.name.trim().split(/\s+/u);
  return { firstName: user.firstName || first, lastName: user.lastName || rest.join(" ") };
}

export function avatarInitials(name: string) {
  return name.trim().split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => Array.from(part)[0]).join("").toLocaleUpperCase("ru") || "?";
}

export function isAvatarPath(path: unknown): path is string {
  return typeof path === "string" && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(path);
}
