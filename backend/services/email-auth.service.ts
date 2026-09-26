import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { getSupabaseAuthClient } from "@/backend/infrastructure/supabase/auth-client";
import { findInvitationByToken } from "@/backend/services/network.service";

type AuthError = { error: string; status: number; retryAfter?: number };
type PendingEmail = { verificationRequired: true; email: string; resendAfter: number };
type Identity = { accountId: string };
const pending = (email: string): PendingEmail => ({ verificationRequired: true, email, resendAfter: 60 });
const unavailable = (): AuthError => ({ error: "Подтверждение почты временно недоступно. Попробуйте позже.", status: 503 });

function providerError(error: { status?: number; code?: string }, verifying = false): AuthError {
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return { error: "Слишком много попыток. Подождите минуту и попробуйте ещё раз.", status: 429, retryAfter: 60 };
  }
  if ((error.status || 0) >= 500) return unavailable();
  if (verifying) return { error: "Код неверный или срок его действия истёк. Проверьте код или запросите новый.", status: 400 };
  return { error: "Не удалось отправить письмо. Попробуйте позже.", status: 503 };
}

async function gate(email: string, action: "verify" | "resend"): Promise<AuthError | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return unavailable();
  const result = await admin.rpc("app_email_auth_limit", { p_email: email, p_action: action });
  if (result.error) return unavailable();
  const limit = result.data as { allowed?: boolean; retryAfter?: number } | null;
  if (!limit?.allowed) return { error: "Слишком много попыток. Попробуйте чуть позже.", status: 429, retryAfter: limit?.retryAfter || 60 };
  return null;
}

async function provision(authUserId: string): Promise<Identity | AuthError> {
  const admin = getSupabaseAdmin();
  if (!admin) return unavailable();
  const result = await admin.rpc("app_complete_email_registration", { p_auth_user_id: authUserId });
  // Never attach an existing application account just because emails match.
  if (result.error || typeof result.data !== "string") return unavailable();
  return { accountId: result.data };
}

export async function beginEmailRegistration(input: {
  firstName: string; lastName: string; email: string; password: string; inviteToken?: string;
}): Promise<PendingEmail | AuthError> {
  const admin = getSupabaseAdmin();
  const client = getSupabaseAuthClient();
  if (!admin || !client) return unavailable();
  const email = input.email.trim().toLowerCase();
  const existing = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (existing.error) return unavailable();
  if (existing.data) return { error: "Пользователь с таким email уже зарегистрирован.", status: 409 };
  const legacy = await admin.from("users").select("id").eq("login", email).maybeSingle();
  if (legacy.error) return unavailable();
  if (legacy.data) return { error: "Пользователь с таким email уже зарегистрирован.", status: 409 };
  let invitationId: string | null = null;
  if (input.inviteToken) {
    const invitation = await findInvitationByToken(input.inviteToken);
    if ("validationError" in invitation) return { error: invitation.validationError || "Некорректная ссылка приглашения.", status: 400 };
    if ("error" in invitation || "unavailable" in invitation) return unavailable();
    invitationId = String(invitation.data.id);
  }
  const draft = await admin.from("email_registration_drafts").select("auth_user_id").eq("email", email).maybeSingle();
  if (draft.error) return unavailable();
  if (draft.data) {
    const blocked = await gate(email, "resend");
    if (blocked) return blocked;
  }
  const result = await client.auth.signUp({ email, password: input.password });
  if (result.error) return providerError(result.error);
  // Confirm Email must be enabled. Fail closed if the dashboard is misconfigured.
  if (result.data.session) return { error: "Сервер подтверждения почты не настроен. Обратитесь к администратору.", status: 503 };
  const user = result.data.user;
  if (!user || user.email_confirmed_at || user.identities?.length === 0) {
    return { error: "Этот email уже используется. Попробуйте войти в аккаунт.", status: 409 };
  }
  const saved = await admin.from("email_registration_drafts").upsert({
    auth_user_id: user.id, email, first_name: input.firstName.trim(), last_name: input.lastName.trim(), invitation_id: invitationId,
  }, { onConflict: "auth_user_id" });
  if (saved.error) return unavailable();
  return pending(email);
}

export async function verifyEmailRegistration(email: string, code: string): Promise<Identity | AuthError> {
  const client = getSupabaseAuthClient();
  if (!client) return unavailable();
  const blocked = await gate(email, "verify");
  if (blocked) return blocked;
  const result = await client.auth.verifyOtp({ email, token: code, type: "email" });
  if (result.error) return providerError(result.error, true);
  const user = result.data.user;
  if (!user?.email_confirmed_at || user.email?.toLowerCase() !== email) return unavailable();
  return provision(user.id);
}

export async function resendRegistrationEmail(email: string): Promise<PendingEmail | AuthError> {
  const client = getSupabaseAuthClient();
  if (!client) return unavailable();
  const blocked = await gate(email, "resend");
  if (blocked) return blocked;
  const result = await client.auth.resend({ type: "signup", email });
  if (result.error) return providerError(result.error);
  return pending(email);
}

export async function authenticateEmailAccount(email: string, password: string, expectedAuthId?: string): Promise<Identity | PendingEmail | AuthError> {
  const client = getSupabaseAuthClient();
  if (!client) return unavailable();
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) {
    if (result.error.code === "email_not_confirmed") return { ...pending(email), resendAfter: 0 };
    if (result.error.status === 429 || (result.error.status || 0) >= 500) return providerError(result.error);
    return { error: "Неверный email или пароль.", status: 401 };
  }
  const user = result.data.user;
  if (!user?.email_confirmed_at || user.email?.toLowerCase() !== email || (expectedAuthId && user.id !== expectedAuthId)) {
    return { error: "Неверный email или пароль.", status: 401 };
  }
  return provision(user.id);
}
