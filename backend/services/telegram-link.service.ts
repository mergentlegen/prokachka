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

  const link = await supabase.from("telegram_link_tokens").select("token,user_id,expires_at,used_at").eq("token", token).maybeSingle();
  if (link.error || !link.data || link.data.used_at || new Date(String(link.data.expires_at)).getTime() <= Date.now()) return { error: "Ссылка привязки устарела. Создайте новую на сайте." };

  const existing = await supabase.from("users").select("id").eq("telegram_id", telegramId).maybeSingle();
  if (existing.error) return { error: existing.error };
  if (existing.data && String(existing.data.id) !== String(link.data.user_id)) return { error: "Этот Telegram уже привязан к другому аккаунту." };

  const updated = await supabase.from("users").update({ telegram_id: telegramId }).eq("id", link.data.user_id).select("id").single();
  if (updated.error) return { error: updated.error.code === "23505" ? "Этот Telegram уже привязан к другому аккаунту." : updated.error };

  await supabase.from("telegram_link_tokens").update({ used_at: new Date().toISOString() }).eq("token", token).is("used_at", null);
  return { userId: String(link.data.user_id) };
}