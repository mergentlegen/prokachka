import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/backend/config/env";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { findInvitationByToken } from "@/backend/services/network.service";
import type { AuthUser } from "@/shared/domain/types";

type StoredAccount = { user: AuthUser; passwordHash: string };
const demoAccounts = new Map<string, StoredAccount>();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}

function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
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
    login: email,
    telegramId: row.telegram_id ? String(row.telegram_id) : undefined,
    role: row.role === "ceo" ? "ceo" : row.role === "admin" ? "admin" : "member",
    teamId: row.team_id ? String(row.team_id) : undefined,
    teamJoinedAt: row.team_joined_at ? String(row.team_joined_at) : undefined,
    parentUserId: row.parent_user_id ? String(row.parent_user_id) : undefined,
    canReview: Boolean(row.can_review),
    canPublishTasks: Boolean(row.can_publish_tasks),
    canInviteMembers: Boolean(row.can_invite_members),
  };
}

export async function findAccountById(id: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase
    .from("users")
    .select("id,name,first_name,last_name,email,login,telegram_id,role,team_id,team_joined_at,parent_user_id,can_review,can_publish_tasks,can_invite_members")
    .eq("id", id)
    .maybeSingle();
  return error || !data ? null : publicUser(data);
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
  if (typeof password !== "string" || password.length < 6) {
    return "Пароль должен содержать минимум 6 символов.";
  }
  return null;
}

export function validateLoginCredentials(email: unknown, password: unknown) {
  if (
    typeof email !== "string" ||
    email.trim().length > 254 ||
    !emailPattern.test(email.trim())
  ) {
    return "Введите корректный email.";
  }
  if (typeof password !== "string" || password.length < 6) {
    return "Пароль должен содержать минимум 6 символов.";
  }
  return null;
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
  const passwordHash = hashPassword(password);
  const supabase = getSupabaseAdmin();

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
      .select("id,name,first_name,last_name,email,login,telegram_id,role,team_id,team_joined_at,parent_user_id,can_review,can_publish_tasks,can_invite_members")
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
  if (supabase) {
    let data: Record<string, unknown> | null = null;
    let error: { message?: string } | null = null;

    const byEmail = await supabase
      .from("users")
      .select("id,name,first_name,last_name,email,login,telegram_id,role,team_id,team_joined_at,parent_user_id,can_review,can_publish_tasks,can_invite_members,password_hash")
      .eq("email", normalizedEmail)
      .maybeSingle();

    data = byEmail.data as Record<string, unknown> | null;
    error = byEmail.error;

    if (!data && !error) {
      const legacy = await supabase
        .from("users")
        .select("id,name,first_name,last_name,email,login,telegram_id,role,team_id,team_joined_at,parent_user_id,can_review,can_publish_tasks,can_invite_members,password_hash")
        .eq("login", normalizedEmail)
        .maybeSingle();
      data = legacy.data as Record<string, unknown> | null;
      error = legacy.error;
    }

    if (error || !data || !verifyPassword(password, String(data.password_hash))) {
      return { error: "Неверный email или пароль." };
    }
    return { user: publicUser(data) };
  }

  const account = demoAccounts.get(normalizedEmail);
  if (!account || !verifyPassword(password, account.passwordHash)) {
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

export function createSession(user: AuthUser) {
  const secret = getSessionSecret();
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  const payload = Buffer.from(
    JSON.stringify({ ...user, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function readSession(token: string | undefined): AuthUser | null {
  const secret = getSessionSecret();
  if (!token || !secret) return null;
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
    const user = JSON.parse(Buffer.from(payload, "base64url").toString()) as AuthUser & {
      exp?: number;
    };
    return user.exp && user.exp > Date.now() ? user : null;
  } catch {
    return null;
  }
}
