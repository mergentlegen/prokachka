import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { serverEnv } from "@/backend/config/env";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { findInvitationByToken } from "@/backend/services/network.service";
import type { AuthUser } from "@/shared/domain/types";
import { withAvatarUrls } from "@/backend/services/avatar-urls.service";
import { authenticateEmailAccount } from "@/backend/services/email-auth.service";
import { validateExistingPassword, validateNewPassword } from "@/shared/domain/password-policy";

type StoredAccount = { user: AuthUser; passwordHash: string };
const demoAccounts = new Map<string, StoredAccount>();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export const validatePassword = validateNewPassword;
const deriveKey = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = ((await deriveKey(password, salt, 64)) as Buffer).toString("hex");
  return salt + ":" + hash;
}

async function verifyPassword(password: string, stored: string) {
  if (!/^[^:]{1,128}:[a-f0-9]{128}$/i.test(stored)) return false;
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = (await deriveKey(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function valueOrUndefined(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function publicUser(row: Record<string, unknown>): AuthUser {
  const email = valueOrUndefined(row.email) || valueOrUndefined(row.login);
  const name =
    valueOrUndefined(row.name) ||
    [valueOrUndefined(row.first_name), valueOrUndefined(row.last_name)]
      .filter(Boolean)
      .join(" ") ||
    "Участник";

  return {
    id: String(row.id),
    name,
    firstName: valueOrUndefined(row.first_name),
    lastName: valueOrUndefined(row.last_name),
    avatarUrl: valueOrUndefined(row.avatar_url),
    profileVersion: valueOrUndefined(row.profile_updated_at),
    login: email,
    telegramId: row.telegram_id ? String(row.telegram_id) : undefined,
    role: row.role === "ceo" ? "ceo" : row.role === "admin" ? "admin" : "member",
    teamId: row.team_id ? String(row.team_id) : undefined,
    teamJoinedAt: row.team_joined_at ? String(row.team_joined_at) : undefined,
    parentUserId: row.parent_user_id ? String(row.parent_user_id) : undefined,
    canReview: Boolean(row.can_review),
    canPublishTasks: Boolean(row.can_publish_tasks),
    canInviteMembers: Boolean(row.can_invite_members),
    sessionVersion: Number(row.session_version) || 0,
  };
}

export async function findAccountById(id: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const fields = "id,name,first_name,last_name,avatar_path,profile_updated_at,email,login,telegram_id,role,team_id,team_joined_at,parent_user_id,can_review,can_publish_tasks,can_invite_members";
  let result = await supabase
    .from("users")
    .select(fields + ",session_version")
    .eq("id", id)
    .maybeSingle();
  if (result.error?.code === "42703" && result.error.message.includes("session_version")) {
    result = await supabase.from("users").select(fields).eq("id", id).maybeSingle();
  }
  const { data, error } = result;
  return error || !data ? null : publicUser((await withAvatarUrls([data as unknown as Record<string, unknown>]))[0]);
}

export function getSessionToken(request: Request) {
  if (serverEnv.authDevMode) {
    return (
      request.headers.get("x-incruises-dev-session") ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    );
  }
  return request.headers.get("cookie")?.match(/(?:^|;\s*)incruises_session=([^;]+)/)?.[1];
}

export function validateRegistration(
  firstName: unknown,
  lastName: unknown,
  email: unknown,
  password: unknown,
) {
  if (
    typeof firstName !== "string" ||
    firstName.trim().length < 2 ||
    firstName.trim().length > 60
  ) {
    return "Имя должно содержать от 2 до 60 символов.";
  }
  if (
    typeof lastName !== "string" ||
    lastName.trim().length < 2 ||
    lastName.trim().length > 80
  ) {
    return "Фамилия должна содержать от 2 до 80 символов.";
  }
  if (
    typeof email !== "string" ||
    email.trim().length > 254 ||
    !emailPattern.test(email.trim())
  ) {
    return "Введите корректный email.";
  }
  return validatePassword(password);
}

export function validateLoginCredentials(email: unknown, password: unknown) {
  if (
    typeof email !== "string" ||
    email.trim().length > 254 ||
    !emailPattern.test(email.trim())
  ) {
    return "Введите корректный email.";
  }
  return validateExistingPassword(password);
}

export async function registerAccount(
  firstName: string,
  lastName: string,
  email: string,
  password: string,
  inviteToken?: string,
) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedFirstName = firstName.trim();
  const normalizedLastName = lastName.trim();
  const fullName = normalizedFirstName + " " + normalizedLastName;
  const passwordError = validatePassword(password);
  if (passwordError) return { validationError: passwordError };
  const supabase = getSupabaseAdmin();

  if (!supabase && process.env.NODE_ENV === "production") return { error: "Сервис авторизации временно недоступен.", status: 503 };
  const passwordHash = await hashPassword(password);

  if (supabase) {
    let invitation: { id: string; team_id: string; inviter_user_id: string } | undefined;
    if (inviteToken) {
      const invitationResult = await findInvitationByToken(inviteToken);
      if ("unavailable" in invitationResult) return { error: "База данных не настроена." };
      if ("error" in invitationResult) return { error: "Не удалось проверить ссылку приглашения." };
      if ("validationError" in invitationResult) return { validationError: invitationResult.validationError };
      invitation = invitationResult.data as typeof invitation;
    }
    const { data, error } = await supabase
      .from("users")
      .insert({
        first_name: normalizedFirstName,
        last_name: normalizedLastName,
        name: fullName,
        email: normalizedEmail,
        login: normalizedEmail,
        password_hash: passwordHash,
        role: "member",
      })
      .select("id,name,first_name,last_name,profile_updated_at,email,login,telegram_id,role,team_id,team_joined_at,parent_user_id,can_review,can_publish_tasks,can_invite_members")
      .single();

    if (error) {
      return {
        error:
          error.code === "23505"
            ? "Пользователь с таким email уже зарегистрирован."
            : "Не удалось создать аккаунт.",
      };
    }

    if (invitation) {
      const request = await supabase.from("team_join_requests").insert({ user_id: data.id, team_id: invitation.team_id, invited_by_user_id: invitation.inviter_user_id, invitation_id: invitation.id }).select().single();
      if (request.error) {
        await supabase.from("users").delete().eq("id", data.id);
        return { error: "Не удалось создать заявку по ссылке приглашения." };
      }
    }

    return { user: publicUser(data) };
  }

  if (demoAccounts.has(normalizedEmail)) {
    return { error: "Пользователь с таким email уже зарегистрирован." };
  }

  const user: AuthUser = {
    id: "auth-" + randomBytes(8).toString("hex"),
    name: fullName,
    login: normalizedEmail,
    role: "member",
  };
  demoAccounts.set(normalizedEmail, { user, passwordHash });
  return { user };
}

export async function authenticateAccount(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);

  if (
    serverEnv.ceoLogin &&
    serverEnv.ceoPassword &&
    normalizedEmail === normalizeEmail(serverEnv.ceoLogin) &&
    password === serverEnv.ceoPassword
  ) {
    return {
      user: {
        id: "ceo",
        name: "CEO",
        login: normalizedEmail,
        role: "ceo" as const,
      },
    };
  }

  const supabase = getSupabaseAdmin();
  if (!supabase && process.env.NODE_ENV === "production") return { error: "Сервис авторизации временно недоступен.", status: 503 };
  if (supabase) {
    let data: Record<string, unknown> | null = null;
    let error: { message?: string } | null = null;
    const accountFields = "id,name,first_name,last_name,avatar_path,profile_updated_at,email,login,telegram_id,role,team_id,team_joined_at,parent_user_id,can_review,can_publish_tasks,can_invite_members,password_hash";
    async function lookup(field: "email" | "login") {
      let fields = accountFields + ",auth_user_id,session_version";
      let result = await supabase!.from("users").select(fields).eq(field, normalizedEmail).maybeSingle();
      if (result.error?.code === "42703" && result.error.message.includes("session_version")) {
        fields = accountFields + ",auth_user_id";
        result = await supabase!.from("users").select(fields).eq(field, normalizedEmail).maybeSingle();
      }
      // Rolling deployment before the additive migration is safe only while the
      // new signup flow is disabled. Do not mask any other database error.
      if (!serverEnv.emailVerificationEnabled && result.error?.code === "42703" && result.error.message.includes("auth_user_id")) {
        return supabase!.from("users").select(accountFields).eq(field, normalizedEmail).maybeSingle();
      }
      return result;
    }

    const byEmail = await lookup("email");

    data = byEmail.data as Record<string, unknown> | null;
    error = byEmail.error;

    if (!data && !error) {
      const legacy = await lookup("login");
      data = legacy.data as Record<string, unknown> | null;
      error = legacy.error;
    }

    if (error) return { error: "Сервис авторизации временно недоступен.", status: 503 };
    if (data?.auth_user_id || (!data && serverEnv.emailVerificationEnabled)) {
      const result = await authenticateEmailAccount(normalizedEmail, password, data?.auth_user_id ? String(data.auth_user_id) : undefined);
      if (!("accountId" in result)) return result;
      const user = await findAccountById(result.accountId);
      return user ? { user } : { error: "Сервис авторизации временно недоступен.", status: 503 };
    }
    if (!data || !await verifyPassword(password, String(data.password_hash))) {
      return { error: "Неверный email или пароль." };
    }
    return { user: publicUser((await withAvatarUrls([data]))[0]) };
  }

  const account = demoAccounts.get(normalizedEmail);
  if (!account || !await verifyPassword(password, account.passwordHash)) {
    return { error: "Неверный email или пароль." };
  }
  return { user: account.user };
}

function getSessionSecret() {
  const secret = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") {
    return secret && secret.length >= 32 ? secret : null;
  }
  return secret || serverEnv.adminPassword || "development-only-session-secret";
}

function systemCredentialVersion(secret: string) {
  return createHmac("sha256", secret).update(`system-account:${serverEnv.ceoLogin}:${serverEnv.ceoPassword}`).digest("base64url");
}

export function createSession(user: AuthUser) {
  const secret = getSessionSecret();
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  const { avatarUrl: _avatarUrl, firstName: _firstName, lastName: _lastName, profileVersion: _profileVersion, ...identity } = user;
  const payload = Buffer.from(
    JSON.stringify({ ...identity, ...(user.id === "ceo" ? { credentialVersion: systemCredentialVersion(secret) } : {}), exp: Date.now() + 1000 * 60 * 60 * 24 * 14 }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function readSession(token: string | undefined): AuthUser | null {
  const secret = getSessionSecret();
  if (!token || !secret || token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!user || typeof user !== "object" || Array.isArray(user)
      || typeof user.id !== "string" || !user.id || typeof user.name !== "string"
      || !["ceo", "admin", "member"].includes(user.role)
      || !Number.isFinite(user.exp) || user.exp <= Date.now()) return null;
    if (user.id === "ceo" && (user.role !== "ceo" || !serverEnv.ceoLogin || !serverEnv.ceoPassword
      || user.credentialVersion !== systemCredentialVersion(secret))) return null;
    const { credentialVersion: _version, ...identity } = user;
    return identity as AuthUser;
  } catch {
    return null;
  }
}
