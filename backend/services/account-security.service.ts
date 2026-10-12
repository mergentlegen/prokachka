import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { getSupabaseAuthClient } from "@/backend/infrastructure/supabase/auth-client";
import { hashPassword, verifyPassword } from "@/backend/services/auth.service";
import { validateExistingPassword, validateNewPassword } from "@/shared/domain/password-policy";

type Outcome = { changed: true } | { error: string; status: number };

/**
 * A new password from the profile. The current password is checked first; afterwards every other device
 * has to sign in again. E-mail accounts keep the password in Supabase Auth, older accounts in public.users.
 */
export async function changeOwnPassword(userId: string, current: unknown, next: unknown): Promise<Outcome> {
  const currentError = validateExistingPassword(current);
  if (currentError) return { error: "Введите текущий пароль.", status: 400 };
  const nextError = validateNewPassword(next);
  if (nextError) return { error: nextError, status: 400 };
  if (current === next) return { error: "Новый пароль совпадает с текущим. Придумайте другой.", status: 400 };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: "Сервис временно недоступен.", status: 503 };
  const account = await supabase.from("users").select("id,email,login,password_hash,auth_user_id").eq("id", userId).maybeSingle();
  if (account.error || !account.data) return { error: "Сервис временно недоступен.", status: 503 };
  const row = account.data as { email?: string | null; login?: string | null; password_hash?: string | null; auth_user_id?: string | null };

  let newHash: string | null = null;
  if (row.auth_user_id) {
    const client = getSupabaseAuthClient();
    const email = String(row.email || row.login || "").trim().toLowerCase();
    if (!client || !email) return { error: "Сервис временно недоступен.", status: 503 };
    const signedIn = await client.auth.signInWithPassword({ email, password: String(current) });
    if (signedIn.error || signedIn.data.user?.id !== row.auth_user_id) {
      if (signedIn.error && (signedIn.error.status === 429 || (signedIn.error.status || 0) >= 500)) return { error: "Сервис временно недоступен. Попробуйте позже.", status: 503 };
      return { error: "Текущий пароль указан неверно.", status: 400 };
    }
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    const updated = await supabase.auth.admin.updateUserById(row.auth_user_id, { password: String(next) });
    if (updated.error) {
      if (updated.error.code === "weak_password" || updated.error.code === "validation_failed") return { error: "Этот пароль слишком простой. Выберите другой пароль.", status: 400 };
      return { error: "Не удалось сменить пароль. Попробуйте ещё раз.", status: 503 };
    }
  } else {
    if (!row.password_hash || !await verifyPassword(String(current), row.password_hash)) return { error: "Текущий пароль указан неверно.", status: 400 };
    newHash = await hashPassword(String(next));
  }
  const saved = await supabase.rpc("app_change_password", { p_user: userId, p_password_hash: newHash });
  if (saved.error) return { error: "Не удалось сменить пароль. Попробуйте ещё раз.", status: 503 };
  return { changed: true };
}

/** Phones of the participants this mentor may see (the team leader: the team; a reviewer: their branch). */
export async function visiblePhones(viewerId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_visible_phones", { p_viewer: viewerId });
  if (result.error) return { error: result.error };
  const data = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
  return { data: Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === "string")) };
}

/** Own phone, team and mentor names for the profile. */
export async function ownProfileExtras(userId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_own_profile_extras", { p_user: userId });
  if (result.error) return { error: result.error };
  const data = (result.data || {}) as Record<string, unknown>;
  const text = (value: unknown) => typeof value === "string" && value ? value : undefined;
  return { data: { phone: text(data.phone), teamName: text(data.teamName), mentorName: text(data.mentorName), branchSize: Number(data.branchSize) || 0 } };
}

export async function setOwnPhone(userId: string, phone: string | null) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_set_own_phone", { p_user: userId, p_phone: phone });
  if (result.error) return { error: result.error };
  const data = (result.data || {}) as { validationError?: string; forbidden?: boolean };
  if (data.validationError) return { validationError: data.validationError };
  return data.forbidden ? { error: new Error("forbidden") } : { data: true as const };
}

export type MemberProgram = { programId: string; title: string; status: "active" | "completed"; currentTaskId?: string; currentStep?: number; totalSteps: number; completedAt?: string };

/** The programs the participant has started, with the step they are on. */
export async function memberPrograms(userId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_member_programs", { p_user: userId });
  if (result.error) return { error: result.error };
  const rows = Array.isArray(result.data) ? result.data as Record<string, unknown>[] : [];
  return { data: rows.map((row): MemberProgram => ({
    programId: String(row.programId), title: String(row.title || "Программа"), status: row.status === "completed" ? "completed" : "active",
    currentTaskId: row.currentTaskId ? String(row.currentTaskId) : undefined, currentStep: Number(row.currentStep) || undefined,
    totalSteps: Number(row.totalSteps) || 0, completedAt: row.completedAt ? String(row.completedAt) : undefined,
  })) };
}

/** Removes the Telegram link of the own account. */
export async function unlinkOwnTelegram(userId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_unlink_telegram", { p_user: userId });
  if (result.error) return { error: result.error };
  return (result.data as { unlinked?: boolean } | null)?.unlinked ? { data: true as const } : { error: new Error("unlink_failed") };
}
