import { failure, ok } from "@/backend/http/api-response";
import { enforceRateLimit, isProductionConfigSafe } from "@/backend/http/security";
import { serverEnv } from "@/backend/config/env";
import {
  authenticateAccount,
  createSession,
  findAccountById,
  getSessionToken,
  readSession,
  registerAccount,
  validateLoginCredentials,
  validateRegistration,
} from "@/backend/services/auth.service";
import type { AuthUser } from "@/shared/domain/types";
import { beginEmailRegistration, resendRegistrationEmail, verifyEmailRegistration } from "@/backend/services/email-auth.service";

function emailFailure(result: { error: string; status: number; retryAfter?: number }) {
  const response = failure(result.error, result.status);
  if (result.retryAfter) response.headers.set("Retry-After", String(result.retryAfter));
  return response;
}

export async function confirmEmail(request: Request) {
  if (!isProductionConfigSafe()) return failure("Сервер авторизации не настроен.", 503);
  try {
    const body = await request.json();
    if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) return failure("Введите корректный email.", 400);
    if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) return failure("Введите шестизначный код из письма.", 400);
    const result = await verifyEmailRegistration(body.email.trim().toLowerCase(), body.code);
    if ("error" in result) return emailFailure(result);
    const user = await findAccountById(result.accountId);
    if (!user) return failure("Не удалось завершить регистрацию. Попробуйте войти по почте и паролю.", 503);
    return ok({ user, session: createSession(user), devAuthMode: serverEnv.authDevMode });
  } catch { return failure("Не удалось подтвердить почту. Попробуйте ещё раз.", 503); }
}

export async function resendEmail(request: Request) {
  if (!isProductionConfigSafe()) return failure("Сервер авторизации не настроен.", 503);
  try {
    const body = await request.json();
    if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) return failure("Введите корректный email.", 400);
    const result = await resendRegistrationEmail(body.email.trim().toLowerCase());
    return "error" in result ? emailFailure(result) : ok(result, 202);
  } catch { return failure("Не удалось отправить письмо. Попробуйте позже.", 503); }
}

export async function register(request: Request) {
  if (!isProductionConfigSafe()) {
    return failure("Сервер авторизации не настроен.", 503);
  }

  try {
    const body = await request.json();
    const validationError = validateRegistration(
      body.firstName,
      body.lastName,
      body.email,
      body.password,
    );

    if (validationError) return failure(validationError, 400);
    if (body.password !== body.passwordConfirmation) {
      return failure("Пароли не совпадают.", 400);
    }

    const inviteToken = body.inviteToken === undefined ? undefined : String(body.inviteToken);
    if (inviteToken && (inviteToken.length < 20 || inviteToken.length > 128 || !/^[A-Za-z0-9_-]+$/.test(inviteToken))) {
      return failure("Некорректная ссылка приглашения.", 400);
    }
    if (serverEnv.emailVerificationEnabled) {
      const blocked = enforceRateLimit(`auth-register-email:${body.email.trim().toLowerCase()}`, 1, 60_000);
      if (blocked) return blocked;
      const result = await beginEmailRegistration({ firstName: body.firstName, lastName: body.lastName, email: body.email, password: body.password, inviteToken });
      return "error" in result ? emailFailure(result) : ok(result, 202);
    }
    const result = await registerAccount(
      body.firstName,
      body.lastName,
      body.email,
      body.password,
      inviteToken,
    );
    if ("validationError" in result) return failure(result.validationError || "Некорректная ссылка приглашения.", 400);
    if (result.error) return failure(result.error, 409);

    return ok(
      {
        user: result.user,
        session: createSession(result.user as AuthUser),
        devAuthMode: serverEnv.authDevMode,
      },
      201,
    );
  } catch {
    return failure("Не удалось создать аккаунт.", 400);
  }
}

export async function login(request: Request) {
  if (!isProductionConfigSafe()) {
    return failure("Сервер авторизации не настроен.", 503);
  }

  try {
    const body = await request.json();
    const validationError = validateLoginCredentials(body.email, body.password);
    if (validationError) return failure(validationError, 400);

    const emailKey = body.email.trim().toLowerCase();
    const emailBlocked = enforceRateLimit(`auth-login-email:${emailKey}`, 10, 60_000);
    if (emailBlocked) return emailBlocked;

    const result = await authenticateAccount(body.email, body.password);
    if ("verificationRequired" in result) return ok(result, 202);
    if ("error" in result && result.error) return failure(result.error, "status" in result ? result.status : 401);
    if (!("user" in result) || !result.user) return failure("Не удалось выполнить вход.", 503);

    return ok({
      user: result.user,
      session: createSession(result.user as AuthUser),
      devAuthMode: serverEnv.authDevMode,
    });
  } catch {
    return failure("Не удалось выполнить вход.", 400);
  }
}

export async function session(request: Request) {
  if (!isProductionConfigSafe()) {
    return failure("Сервер авторизации не настроен.", 503);
  }

  const token = getSessionToken(request);
  const user = readSession(token);
  if (!user) return failure("Сессия не найдена.", 401);

  const currentUser = user.id === "ceo" ? user : await findAccountById(user.id);
  if (!currentUser) return failure("Пользователь не найден.", 401);
  if ((currentUser.sessionVersion || 0) !== (user.sessionVersion || 0)) return failure("Пароль изменён. Войдите в аккаунт заново.", 401);

  return ok({
    user: currentUser,
    session: createSession(currentUser),
    devAuthMode: serverEnv.authDevMode,
  });
}
