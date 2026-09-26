import { failure, ok } from "@/backend/http/api-response";
import { isProductionConfigSafe } from "@/backend/http/security";
import { passwordRecoveryCookie, readPasswordRecoveryCookie } from "@/backend/http/password-recovery-cookie";
import { sessionCookie } from "@/backend/http/session-cookie";
import { serverEnv } from "@/backend/config/env";
import { requestPasswordRecovery, verifyPasswordRecovery, resetRecoveredPassword } from "@/backend/services/password-recovery.service";
import { validatePassword } from "@/backend/services/auth.service";

function ready() { return isProductionConfigSafe() && serverEnv.emailVerificationEnabled; }
function validEmail(email: unknown): email is string {
  return typeof email === "string" && email.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
function failed(result: { error: string; status: number; retryAfter?: number }) {
  const response = failure(result.error, result.status);
  if (result.retryAfter) response.headers.set("Retry-After", String(result.retryAfter));
  return response;
}
function unavailable() { return failure("Восстановление пароля временно недоступно. Попробуйте позже.", 503); }
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const value = await request.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export async function requestRecovery(request: Request) {
  if (!ready()) return unavailable();
  try {
    const body = await readBody(request);
    if (!body) return failure("Некорректный запрос.", 400);
    if (!validEmail(body.email)) return failure("Введите корректный email.", 400);
    const result = await requestPasswordRecovery(body.email.trim().toLowerCase());
    if ("error" in result) return failed(result);
    const response = ok(result, 202);
    response.headers.append("Set-Cookie", passwordRecoveryCookie("", 0));
    return response;
  } catch { return unavailable(); }
}

export async function verifyRecovery(request: Request) {
  if (!ready()) return unavailable();
  try {
    const body = await readBody(request);
    if (!body) return failure("Некорректный запрос.", 400);
    if (!validEmail(body.email)) return failure("Введите корректный email.", 400);
    if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) return failure("Введите шестизначный код из письма.", 400);
    const result = await verifyPasswordRecovery(body.email.trim().toLowerCase(), body.code);
    if ("error" in result) return failed(result);
    const response = ok({ recoveryVerified: true, expiresIn: result.expiresIn });
    response.headers.append("Set-Cookie", passwordRecoveryCookie(result.token, result.expiresIn));
    return response;
  } catch { return unavailable(); }
}

export async function resetPassword(request: Request) {
  if (!ready()) return unavailable();
  try {
    const token = readPasswordRecoveryCookie(request);
    if (!token) return failure("Время восстановления истекло. Запросите новый код.", 410);
    const body = await readBody(request);
    if (!body) return failure("Некорректный запрос.", 400);
    const invalid = validatePassword(body.password);
    if (invalid) return failure(invalid, 400);
    if (body.password !== body.passwordConfirmation) return failure("Пароли не совпадают.", 400);
    const result = await resetRecoveredPassword(token, body.password as string);
    if ("error" in result) {
      const response = failed(result);
      if (result.status === 410) response.headers.append("Set-Cookie", passwordRecoveryCookie("", 0));
      return response;
    }
    const response = ok(result);
    response.headers.append("Set-Cookie", passwordRecoveryCookie("", 0));
    response.headers.append("Set-Cookie", sessionCookie("", 0));
    return response;
  } catch { return unavailable(); }
}
