import { NextResponse } from "next/server";
import { failure, ok } from "@/backend/http/api-response";
import { getRequestUser } from "@/backend/http/auth-guard";
import { isValidTelegramSecret, serverEnv } from "@/backend/config/env";
import { isUuid } from "@/backend/http/security";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { attachTelegramSubmission } from "@/backend/services/submissions.service";
import { createTelegramLinkToken, linkTelegramAccount } from "@/backend/services/telegram-link.service";
import { notifyMentorsAboutSubmission, sendTelegramMessage } from "@/backend/services/telegram-notifications.service";

function botUsername() {
  return serverEnv.telegramBotUsername?.replace(/^@/, "");
}


export async function createTelegramLink(request: Request) {
  const user = getRequestUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role === "ceo") return failure("Для CEO привязка Telegram пока не требуется.", 400);
  if (!botUsername() || !serverEnv.telegramBotToken) return failure("Telegram-бот пока не настроен.", 503);

  const result = await createTelegramLinkToken(user.id);
  if ("unavailable" in result) return failure("База данных пока не настроена.", 503);
  if ("alreadyLinked" in result) return ok({ linked: true, telegramId: result.telegramId });
  if (result.error) return failure("Не удалось создать ссылку привязки.");
  return ok({ linked: false, url: "https://t.me/" + botUsername() + "?start=link_" + result.token, expiresAt: result.expiresAt });
}

export async function telegramLinkStatus(request: Request) {
  const user = getRequestUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role === "ceo") return ok({ linked: false });
  const supabase = getSupabaseAdmin();
  if (!supabase) return failure("База данных пока не настроена.", 503);
  const result = await supabase.from("users").select("telegram_id").eq("id", user.id).maybeSingle();
  if (result.error || !result.data) return failure("Не удалось проверить привязку Telegram.");
  return ok({ linked: Boolean(result.data.telegram_id), telegramId: result.data.telegram_id ? String(result.data.telegram_id) : undefined });
}

export function startTelegram(request: Request) {
  const taskId = new URL(request.url).searchParams.get("taskId");
  if (!taskId || !isUuid(taskId) || !botUsername()) return failure("Telegram-бот пока не настроен. Добавьте TELEGRAM_BOT_USERNAME в .env.local.", 503);
  return NextResponse.redirect("https://t.me/" + botUsername() + "?start=task_" + encodeURIComponent(taskId));
}

export async function receiveTelegramUpdate(request: Request) {
  if (!isValidTelegramSecret(request.headers.get("x-telegram-bot-api-secret-token"))) return failure("Доступ запрещён", 401);
  try {
    const update = await request.json();
    const message = update?.message;
    const chatType = message?.chat?.type;
    const media = message?.photo?.at(-1) || message?.video || message?.document;
    const startText = typeof message?.text === "string" ? message.text : "";
    const linkToken = startText.match(/^\/start(?:@[^\s]+)?\s+link_([A-Za-z0-9_-]+)/)?.[1];
    const startTaskId = startText.match(/^\/start(?:@[^\s]+)?\s+task_([a-zA-Z0-9_-]+)/)?.[1];
    const captionTaskId = typeof message?.caption === "string" ? message.caption.match(/task_([a-zA-Z0-9_-]+)/)?.[1] : undefined;
    const telegramUserId = message?.from?.id;
    const telegramChatId = message?.chat?.id;
    const updateId = typeof update?.update_id === "number" && Number.isSafeInteger(update.update_id) ? update.update_id : undefined;
    const supabase = getSupabaseAdmin();

    if (linkToken && telegramUserId && telegramChatId && chatType === "private") {
      const result = await linkTelegramAccount(linkToken, String(telegramUserId));
      const linkMessage = "error" in result ? (typeof result.error === "string" ? result.error : "Не удалось привязать Telegram. Создайте новую ссылку на сайте.") : "Готово! Telegram привязан к вашему аккаунту. Теперь можно отправлять работы с сайта.";
      await sendTelegramMessage(String(telegramChatId), linkMessage);
      return NextResponse.json({ ok: true });
    }

    if (supabase && startTaskId && isUuid(startTaskId) && telegramUserId && telegramChatId && chatType === "private") {
      await supabase.from("telegram_contexts").upsert({ telegram_id: String(telegramUserId), task_id: startTaskId, expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() }, { onConflict: "telegram_id" });
      await sendTelegramMessage(String(telegramChatId), "Задание выбрано. Теперь отправьте сюда фото или видео своей работы.");
    }

    if (supabase && media && telegramUserId && telegramChatId && chatType === "private") {
      const { data: context } = await supabase.from("telegram_contexts").select("task_id,expires_at").eq("telegram_id", String(telegramUserId)).maybeSingle();
      const contextExpired = context?.expires_at && new Date(String(context.expires_at)).getTime() <= Date.now();
      if (contextExpired) await supabase.from("telegram_contexts").delete().eq("telegram_id", String(telegramUserId));
      const taskId = contextExpired ? undefined : context?.task_id || captionTaskId;
      if (taskId && isUuid(taskId)) {
        const result = await attachTelegramSubmission({ telegramId: String(telegramUserId), chatId: String(telegramChatId), messageId: String(message?.message_id), taskId, updateId });
        if ("error" in result) {
          console.error("Telegram submission persistence failed", result.error);
          await sendTelegramMessage(String(telegramChatId), "Не удалось принять работу. Проверьте, что Telegram привязан и срок задания не истёк.");
        } else if ("validationError" in result) {
          await sendTelegramMessage(String(telegramChatId), result.validationError || "Не удалось принять работу.");
        } else if (!result.duplicate) {
          await supabase.from("telegram_contexts").delete().eq("telegram_id", String(telegramUserId));
          const notification = await notifyMentorsAboutSubmission(String(result.data.id));
          if ("error" in notification) {
            console.error("Telegram mentor notification failed", notification.error);
            await sendTelegramMessage(String(telegramChatId), "Работа сохранена, но уведомление наставнику не доставлено. Наставник всё равно увидит её в панели.");
          } else if ("unavailable" in notification) {
            await sendTelegramMessage(String(telegramChatId), "Работа сохранена, но база данных временно недоступна для уведомления наставника.");
          } else if (notification.delivered > 0) {
            await sendTelegramMessage(String(telegramChatId), "Работа получена и отправлена наставнику на проверку.");
          } else {
            await sendTelegramMessage(String(telegramChatId), "Работа сохранена. У наставника пока не привязан Telegram, поэтому уведомление не отправлено. Работа доступна в панели наставника.");
          }
        }
      }
    }

    console.info("Telegram submission received", { telegramUserId, telegramChatId, telegramMessageId: message?.message_id, taskId: startTaskId || captionTaskId, mediaType: message?.photo ? "photo" : message?.video ? "video" : message?.document ? "document" : "unknown" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram update processing failed", error);
    return failure("Некорректное обновление Telegram", 400);
  }
}
