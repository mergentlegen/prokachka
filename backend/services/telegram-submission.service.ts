import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { serverEnv } from "@/backend/config/env";

export type TelegramSubmissionResult = {
  data?: { id: string };
  validationError?: string;
  duplicate?: boolean;
  ready?: boolean;
};

export function telegramTokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Selecting a task is not a submission. Only the authenticated webhook can save an answer. */
export async function prepareTelegramSubmission(userId: string, taskId: string) {
  const supabase = getSupabaseAdmin();
  const username = serverEnv.telegramBotUsername?.replace(/^@/, "");
  if (!supabase || !username || !serverEnv.telegramBotToken) return { unavailable: true as const };
  const user = await supabase.from("users").select("id,role,telegram_id").eq("id", userId).maybeSingle();
  if (user.error) return { error: user.error };
  if (!user.data || user.data.role !== "member") return { validationError: "Работу может отправить только участник." };
  if (!user.data.telegram_id) return { validationError: "Сначала привяжите свой Telegram в профиле. Telegram другого аккаунта использовать нельзя." };
  const target = await supabase.rpc("tg_target_error", { p_user_id: userId, p_task_id: taskId });
  if (target.error) return { error: target.error };
  if (target.data) return { validationError: String(target.data) };
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const saved = await supabase.from("telegram_submission_sessions").insert({
    token_hash: telegramTokenHash(token), user_id: userId, task_id: taskId,
    telegram_id: String(user.data.telegram_id), expires_at: expiresAt,
  });
  if (saved.error) return { error: saved.error };
  return { url: `https://t.me/${username}?start=submit_${token}`, expiresAt };
}

export async function beginTelegramSubmission(token: string, telegramId: string, messageId: number) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("tg_begin_submission", {
    p_token_hash: telegramTokenHash(token), p_telegram_id: telegramId, p_message_id: messageId,
  });
  return result.error ? { error: result.error } : result.data as TelegramSubmissionResult;
}

export async function attachTelegramSubmission(input: {
  telegramId: string; chatId: string; messageId: number; updateId: number;
  mediaType: "text" | "photo" | "video" | "document"; answerText: string; telegramFileId?: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("tg_submit_answer", {
    p_telegram_id: input.telegramId, p_chat_id: input.chatId, p_message_id: input.messageId,
    p_update_id: input.updateId, p_media_type: input.mediaType, p_answer_text: input.answerText,
    p_file_id: input.telegramFileId || null,
  });
  return result.error ? { error: result.error } : result.data as TelegramSubmissionResult;
}
