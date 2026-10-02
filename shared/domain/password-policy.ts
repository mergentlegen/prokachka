export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 1024;
export const PASSWORD_HINT = "Минимум 8 символов, заглавная буква и цифра. Спецсимвол не обязателен.";

// The same requirements as checks the sign-up form ticks off while the person types.
export const PASSWORD_RULES = [
  { id: "length", label: "8 символов или больше", test: (password: string) => password.length >= PASSWORD_MIN_LENGTH },
  { id: "upper", label: "заглавная буква", test: (password: string) => /[A-ZА-ЯЁ]/u.test(password) },
  { id: "digit", label: "цифра", test: (password: string) => /[0-9]/.test(password) },
] as const;

// One policy for registration and password changes on both sides of the API.
// Existing accounts must still be able to sign in with their original password.
export function validateNewPassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) return "Пароль должен содержать минимум 8 символов.";
  if (password.length > PASSWORD_MAX_LENGTH) return "Пароль должен содержать не больше 1024 символов.";
  if (!/[A-ZА-ЯЁ]/u.test(password)) return "Добавьте хотя бы одну заглавную букву (A–Z или А–Я).";
  if (!/[0-9]/.test(password)) return "Добавьте хотя бы одну цифру.";
  return null;
}

export function validateExistingPassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 6) return "Введите пароль от аккаунта (не менее 6 символов).";
  if (password.length > PASSWORD_MAX_LENGTH) return "Пароль должен содержать не больше 1024 символов.";
  return null;
}
