import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { NextResponse } from "next/server";
import { failure, ok } from "@/backend/http/api-response";
import { getCurrentUser } from "@/backend/http/current-user";
import { isValidTelegramSecret, serverEnv } from "@/backend/config/env";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { attachTelegramSubmission, beginTelegramSubmission } from "@/backend/services/telegram-submission.service";
import { createTelegramLinkToken, linkTelegramAccount } from "@/backend/services/telegram-link.service";
import { scheduleTelegramDelivery, sendTelegramMessage } from "@/backend/services/telegram-notifications.service";

function botUsername() {
  return serverEnv.telegramBotUsername?.replace(/^@/, "");
}

/** «до 14:35» in Almaty time. */
function untilTime(iso?: string) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }).format(new Date(iso));
}

/** What the bot says when a task is chosen: what to send, how, and until when. */
export function selectedTaskText(selected: { voice?: boolean; quiz?: boolean; title?: string; expiresAt?: string }) {
  const task = selected.title ? `«${selected.title.trim().slice(0, 120)}»` : "";
  const until = untilTime(selected.expiresAt);
  const time = until ? `На отправку 30 минут — до ${until}. Если ничего не придёт, задание останется неотправленным.` : "На отправку 30 минут.";
  if (selected.voice) return [
    `🎙 Задание ${task} выбрано. Ответ — голосовое сообщение.`.replace("  ", " "),
    "Как записать: нажмите и удерживайте микрофон 🎤 справа внизу, скажите ответ и отпустите — сообщение уйдёт само.",
    selected.quiz ? "Ответы на тест уже сохранены и уйдут наставнику вместе с голосовым." : "",
    time,
  ].filter(Boolean).join("\n\n");
  return [
    `Задание ${task} выбрано. Отправьте ответ одним сообщением: текст, фото, видео или файл. Пояснение к файлу добавьте в подпись.`.replace("  ", " "),
    time,
  ].join("\n\n");
}

/** Messages the bot cannot take as an answer: an audio file, a round video, a sticker, a location… */
export function unsupportedMessageText(kind: string) {
  return [
    `❌ ${kind} бот не принимает как ответ.`,
    "Если задание просит голосовое — нажмите и удерживайте микрофон 🎤 справа внизу и запишите сообщение. Иначе отправьте текст, фото, видео или файл.",
    "↻ Просто отправьте ещё раз сюда, пока не прошло 30 минут.",
  ].join("\n\n");
}

/** The answer was saved. */
export function savedAnswerText(answer: { media_type?: unknown; quiz_total?: unknown } | undefined) {
  if (answer?.media_type === "voice" && answer.quiz_total !== null && answer.quiz_total !== undefined) return "✅ Голосовое и ответы на тест отправлены наставнику. Он проверит работу и начислит мили.";
  if (answer?.media_type === "voice") return "✅ Голосовое получено и отправлено наставнику на проверку. Он послушает и начислит мили.";
  return "✅ Ответ сохранён и доступен наставникам вашей ветки. Уведомления в Telegram отправляются автоматически.";
}

const telegramLinkWelcomeMessage = [
  "Твой помощник в клубе inCruises.",
  "",
  "Пошаговая программа запуска на 14 дней: узнай, как путешествовать больше и дешевле, собирай мили за задания и капитанские звёзды за приглашённых друзей.",
  "",
  "Получи гарантированный бонус 100 $",
].join("\n");


export async function createTelegramLink(request: Request) {
  const user = await getCurrentUser(request);
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
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role === "ceo") return ok({ linked: false });
  const supabase = getSupabaseAdmin();
  if (!supabase) return failure("База данных пока не настроена.", 503);
  const result = await supabase.from("users").select("telegram_id").eq("id", user.id).maybeSingle();
  if (result.error || !result.data) return failure("Не удалось проверить привязку Telegram.");
  return ok({ linked: Boolean(result.data.telegram_id), telegramId: result.data.telegram_id ? String(result.data.telegram_id) : undefined });
}

/** Old task-only deep links cannot prove which website account selected the task. */
export async function startTelegram(request: Request) {
  if (!await getCurrentUser(request)) return failure("Сначала войдите в аккаунт.", 401);
  return failure("Обновите страницу сайта и нажмите «Отправить работу» ещё раз.", 410);
}

export async function receiveTelegramUpdate(request: Request) {
  if (!isValidTelegramSecret(request.headers.get("x-telegram-bot-api-secret-token"))) return failure("Доступ запрещён", 401);
  let update;
  try { update = await readLimitedJson(request); } catch (error) { return requestBodyFailure(error) || failure("Некорректное обновление Telegram", 400); }
  const message = update?.message;
  if (!message || message.chat?.type !== "private" || message.from?.is_bot) return NextResponse.json({ ok: true });
  const validId = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  if (!validId(message.from?.id) || !validId(message.chat?.id) || message.from.id !== message.chat.id
    || !validId(message.message_id) || !Number.isSafeInteger(update.update_id) || update.update_id < 0) return failure("Некорректное обновление Telegram", 400);
  const telegramId = String(message.from.id);
  const messageId = message.message_id as number;
  const text = typeof message.text === "string" ? message.text : "";
  const payload = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{1,64})\s*$/)?.[1];
  try {
    if (text.startsWith("/")) {
      if (payload?.startsWith("link_")) {
        // Account switches, including failed ones, must not reuse an earlier selected task.
        const cleared = await beginTelegramSubmission("", telegramId, messageId);
        if ("error" in cleared || "unavailable" in cleared) return failure("Временно недоступно.", 503);
        const linked = await linkTelegramAccount(payload.slice(5), telegramId);
        if ("unavailable" in linked || ("error" in linked && typeof linked.error !== "string")) return failure("Не удалось проверить привязку.", 503);
        const confirmation = await sendTelegramMessage(telegramId, "error" in linked ? String(linked.error) : "Telegram привязан к вашему аккаунту. Выберите задание на сайте, чтобы отправить ответ.");
        if (!("error" in linked) && confirmation.ok) await sendTelegramMessage(telegramId, telegramLinkWelcomeMessage);
        scheduleTelegramDelivery();
      } else {
        const selected = await beginTelegramSubmission(payload?.startsWith("submit_") ? payload.slice(7) : payload?.startsWith("company_voice_") ? payload.slice(14) : payload?.startsWith("captain_") ? payload.slice(8) : "", telegramId, messageId);
        if ("unavailable" in selected || "error" in selected) return failure("Не удалось выбрать задание.", 503);
        if (!selected.duplicate && selected.ready && selected.purpose === "captain-screenshot") {
          if (!selected.summary) return failure("Не удалось подготовить сообщение о круизе.", 503);
          const summary = await sendTelegramMessage(telegramId, selected.summary);
          if (!summary.ok) return failure("Не удалось показать сообщение о круизе. Попробуйте открыть ссылку снова.", 503);
          await sendTelegramMessage(telegramId, "Сообщение выше подготовлено автоматически: копировать и отправлять его не нужно. Прикрепите один скриншот настоящего круиза как фото (не файл и не альбом). Наставники вашей ветки получат сначала этот текст, затем скриншот. После сохранения фото начислится ещё 1 миля — всего 20.");
          return NextResponse.json({ ok: true });
        }
        if (!selected.duplicate) await sendTelegramMessage(telegramId, selected.ready
          ? selected.purpose === "company-voice" && selected.review
            ? "Запишите здесь одно голосовое на 30–60 секунд: расскажите о компании своими словами по плану с сайта. Нажмите на микрофон и отправьте сообщение. Наставник послушает его и начислит мили."
            : selected.purpose === "company-voice"
            ? "Запишите здесь одно голосовое на 30–60 секунд по заданию, которое выбрали на сайте. Нажмите на микрофон и отправьте сообщение. Бот передаст его наставникам вашей ветки. Мили за прохождение уже начислены — повторной оценки не будет."
            : selectedTaskText(selected)
          : payload ? selected.validationError || "Откройте задание на сайте ещё раз."
          : "Выберите задание в своём аккаунте на сайте и нажмите «Отправить работу». После этого отправьте сюда ответ.");
      }
      return NextResponse.json({ ok: true });
    }
    if (message.media_group_id) {
      await sendTelegramMessage(telegramId, "❌ Альбом бот не принимает.\n\nОтправьте одно фото, видео или файл, пояснение добавьте в подпись.\n\n↻ Просто отправьте ещё раз сюда, пока не прошло 30 минут.");
      return NextResponse.json({ ok: true });
    }
    const unsupported = message.audio ? "Аудиофайл" : message.video_note ? "Видеокружок" : message.sticker ? "Стикер" : message.animation ? "GIF" : message.location ? "Геолокацию" : message.contact ? "Контакт" : message.poll ? "Опрос" : "";
    if (unsupported) {
      await sendTelegramMessage(telegramId, unsupportedMessageText(unsupported));
      return NextResponse.json({ ok: true });
    }
    const photo = Array.isArray(message.photo) ? message.photo.at(-1) : undefined;
    const media = photo || message.video || message.document || message.voice;
    const mediaType = media ? photo ? "photo" : message.video ? "video" : message.document ? "document" : "voice" : "text";
    const answerText = media ? (typeof message.caption === "string" ? message.caption : "") : text;
    if (!media && !answerText.trim()) {
      await sendTelegramMessage(telegramId, unsupportedMessageText("Пустое сообщение"));
      return NextResponse.json({ ok: true });
    }
    const result = await attachTelegramSubmission({
      telegramId, chatId: telegramId, messageId, updateId: update.update_id,
      mediaType, answerText, telegramFileId: typeof media?.file_id === "string" ? media.file_id : undefined,
    });
    if ("unavailable" in result || "error" in result) return failure("Не удалось сохранить ответ. Telegram повторит доставку.", 503);
    if (result.validationError) {
      await sendTelegramMessage(telegramId, result.validationError);
    } else if (result.data) {
      scheduleTelegramDelivery();
      if (!result.duplicate) await sendTelegramMessage(telegramId, result.purpose === "company-voice" && result.review
        ? "Голосовое отправлено наставнику на проверку. Когда он послушает, он ответит тебе и начислит мили."
        : result.purpose === "company-voice"
        ? "Голосовое сохранено и поставлено в очередь доставки наставникам вашей ветки. Начисленные мили не изменились."
        : result.purpose === "captain-screenshot" ? "Скриншот сохранён и поставлен в очередь доставки наставникам вашей ветки вместе с сообщением о круизе. Начислена ещё 1 миля — всего 20."
        : savedAnswerText(result.data as { media_type?: unknown; quiz_total?: unknown }));
    } else {
      return failure("Не удалось подтвердить сохранение ответа.", 503);
    }
    return NextResponse.json({ ok: true });
  } catch {
    console.error("Telegram update processing failed", { updateId: update.update_id });
    return failure("Обработка временно недоступна.", 503);
  }
}
