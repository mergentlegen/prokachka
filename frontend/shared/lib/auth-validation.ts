import { validateExistingPassword, validateNewPassword } from "@/shared/domain/password-policy";

export type AuthMode = "login" | "register";
export type AuthValues = { firstName: string; lastName: string; email: string; password: string; passwordConfirmation: string };
export type AuthFieldName = keyof AuthValues;
export type AuthErrors = Partial<Record<AuthFieldName, string>>;

// Shared policy complements, but never replaces, server-side validation.
export function validateAuthForm(mode: AuthMode, values: AuthValues): AuthErrors {
  const errors: AuthErrors = {};
  if (mode === "register") {
    if (values.firstName.trim().length < 2 || values.firstName.trim().length > 60) errors.firstName = "Имя должно содержать от 2 до 60 символов.";
    if (values.lastName.trim().length < 2 || values.lastName.trim().length > 80) errors.lastName = "Фамилия должна содержать от 2 до 80 символов.";
  }
  if (!values.email.trim()) errors.email = "Введите email.";
  else if (values.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = "Укажите email в формате name@example.com.";
  const passwordError = mode === "register" ? validateNewPassword(values.password) : validateExistingPassword(values.password);
  if (passwordError) errors.password = passwordError;
  if (mode === "register" && (!values.passwordConfirmation || values.password !== values.passwordConfirmation)) errors.passwordConfirmation = "Пароли не совпадают.";
  return errors;
}

export function registrationServerField(message: string): AuthFieldName | undefined {
  if (message === "Пользователь с таким email уже зарегистрирован." || message === "Введите корректный email.") return "email";
  if (message === "Пароли не совпадают.") return "passwordConfirmation";
  return undefined;
}
