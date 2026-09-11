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
    if (result.error) return failure(result.error, 401);

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

  return ok({
    user: currentUser,
    session: createSession(currentUser),
    devAuthMode: serverEnv.authDevMode,
  });
}
