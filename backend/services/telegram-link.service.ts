import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

const tokenLifetimeMs = 15 * 60 * 1000;

export async function createTelegramLinkToken(userId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const user = await supabase.from("users").select("id,telegram_id").eq("id", userId).maybeSingle();
  if (user.error || !user.data) return { error: "Пользователь не найден." };
  if (user.data.telegram_id) return { alreadyLinked: true as const, telegramId: String(user.data.telegram_id) };

  await supabase.from("telegram_link_tokens").delete().eq("user_id", userId).is("used_at", null);

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + tokenLifetimeMs).toISOString();
  const result = await supabase.from("telegram_link_tokens").insert({ token, user_id: userId, expires_at: expiresAt });
  if (result.error) return { error: result.error };
  return { token, expiresAt };
}

export async function linkTelegramAccount(token: string, telegramId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token) || !/^\d{1,30}$/.test(telegramId)) return { error: "Ссылка привязки недействительна." };

  const result = await supabase.rpc("tg_link_account", { p_token: token, p_telegram_id: telegramId });
  if (result.error) return { error: result.error.code === "23505" ? "Этот Telegram уже привязан к другому аккаунту." : result.error };
  const data = result.data as { validationError?: string; userId?: string };
  if (data.validationError) return { error: data.validationError };
  if (!data.userId) return { error: "Не удалось подтвердить привязку Telegram." };
  return { userId: data.userId };
}
