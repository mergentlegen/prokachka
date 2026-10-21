import { levelTitle, levelUpMessage } from "@/shared/domain/levels";
import { after } from "next/server";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { serverEnv } from "@/backend/config/env";
import { milesUnit } from "@/shared/domain/miles";

type TelegramApiResponse = {
  ok?: boolean;
  description?: string;
  parameters?: { retry_after?: number };
};

type DeliveryResult = { ok: true } | { ok: false; error: string };

function appUrl() {
  return serverEnv.appUrl?.replace(/\/+$/, "");
}

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return serverEnv.telegramBotToken ? message.replaceAll(serverEnv.telegramBotToken, "[redacted]") : message;
}

/** Sends a Telegram message and exposes delivery errors to the server log. */
export async function sendTelegramMessage(chatId: string, text: string): Promise<DeliveryResult> {
  if (!serverEnv.telegramBotToken) {
    const error = "TELEGRAM_BOT_TOKEN is not configured";
    console.error("Telegram message was not sent", { chatId, error });
    return { ok: false, error };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${serverEnv.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(8_000),
      });
      const payload = await response.json().catch(() => ({})) as TelegramApiResponse;

      if (response.ok && payload.ok) return { ok: true };

      const description = payload.description || `HTTP ${response.status}`;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt === 0) {
        const retryAfter = Math.min(Math.max(Number(payload.parameters?.retry_after || 1), 1), 5);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1_000));
        continue;
      }

      console.error("Telegram API sendMessage failed", { chatId, status: response.status, description });
      return { ok: false, error: description };
    } catch (error) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
      const message = errorText(error);
      console.error("Telegram API request failed", { chatId, error: message });
      return { ok: false, error: message };
    }
  }

  return { ok: false, error: "Telegram delivery failed" };
}

/** Copies the participant's original Telegram message to a mentor chat. */
export async function copyTelegramMessage(toChatId: string, fromChatId: string, messageId: string): Promise<DeliveryResult> {
  if (!serverEnv.telegramBotToken) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured" };
  try {
    const response = await fetch(`https://api.telegram.org/bot${serverEnv.telegramBotToken}/copyMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: toChatId, from_chat_id: fromChatId, message_id: Number(messageId) }),
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json().catch(() => ({})) as TelegramApiResponse;
    if (response.ok && payload.ok) return { ok: true };
    return { ok: false, error: payload.description || `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

type NotificationJob = {
  id: string; recipient_id: string; submission_id: string | null; feedback_event_seq: number | null;
  kind: "permissions" | "submission" | "survey" | "company-voice" | "captain-screenshot" | "feedback" | "task-reminder" | "task-nudge" | "announcement" | "start-reminder" | "miles-recount" | "review" | "level-up" | "submission-timeout";
  payload: { canReview?: boolean; canPublishTasks?: boolean; taskId?: string; announcementId?: string; step?: number; title?: string; from?: number; to?: number; reviewId?: string; level?: number; memberId?: string; session?: string }; summary_sent: boolean; attempts: number; lock_token: string;
};

// Mass mailings go out at this pace: one worker run a minute, personal notifications first.
const JOBS_PER_RUN = 20;

const almatyDateTime = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const almatyHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "numeric", hourCycle: "h23" });

/** Start reminders are queued only in the Almaty daytime so nobody gets a message at night. */
export function isAlmatyDaytime(now = new Date()) {
  const hour = Number(almatyHour.format(now));
  return hour >= 10 && hour < 20;
}

/** Texts of the three "you have not started yet" reminders: friendly, practical, then an offer of help. */
export function startReminderText(step: number, firstName: string, teamName: string, link: string) {
  const name = firstName.trim().slice(0, 60);
  const team = teamName.trim().slice(0, 120) || "ваша команда";
  const lines = step <= 1 ? [
    "👋 " + (name ? name + ", " : "") + "добро пожаловать в «Прокачку»!",
    "Вы уже в команде «" + team + "», а первое задание ещё ждёт вас. Начните сегодня — это займёт несколько минут, а за выполненные задания начисляются мили.",
  ] : step === 2 ? [
    (name ? name + ", з" : "З") + "адания команды «" + team + "» ждут вас 🙂",
    "Выберите любое, выполните и нажмите «Отправить ответ». Наставник проверит работу и даст обратную связь.",
  ] : [
    (name ? name + ", в" : "В") + "ы пока не выполнили ни одного задания.",
    "Если что-то непонятно или не получается начать — напишите своему наставнику, он поможет сделать первый шаг.",
  ];
  return [...lines, link ? "Открыть задания: " + link : ""].filter(Boolean).join("\n");
}

/** The task became cheaper after the participant got its miles: their miles for it went down to the new weight. */
export function milesRecountText(title: string, from: number, to: number, link: string) {
  return [
    "🔄 Изменён вес задания «" + (title.trim().slice(0, 200) || "Задание") + "»: теперь оно даёт " + to + " " + milesUnit(to) + ".",
    "Ваши мили за него пересчитаны: было " + from + ", стало " + to + ".",
    link ? "Открыть сайт: " + link : "",
  ].filter(Boolean).join("\n");
}

/** Nothing came within 30 minutes of choosing the task: it stays not sent. */
export function submissionTimeoutText(title: string, voice: boolean, quiz: boolean, link: string) {
  return [
    "⏰ Прошло 30 минут, а ответ по заданию «" + (title.trim().slice(0, 200) || "Задание") + "» так и не пришёл — задание не отправлено.",
    "Откройте его на сайте и нажмите «" + (quiz ? "Ответить и записать голосовое" : voice ? "🎙️ Записать голосовое" : "Отправить ответ") + "» ещё раз." + (quiz ? " Ответы на тест сохранены — заново отвечать не нужно." : ""),
    link ? "Открыть задания: " + link : "",
  ].filter(Boolean).join("\n\n");
}

/** A new level: the participant gets the congratulation, their mentor learns who moved up. */
export function levelUpText(level: number, memberName: string | null, link: string) {
  const name = levelTitle(level);
  if (memberName !== null) return [
    "🎉 " + (memberName.trim().slice(0, 120) || "Участник") + " — новый уровень: " + level + (level === 2 ? " (" + name + ")" : "") + ".",
    "Звёздный курс пройден: 100 миль и 10 звёзд. Теперь у него новые задания и новый рейтинг.",
    link ? "Структура сети: " + link : "",
  ].filter(Boolean).join("\n");
  const message = levelUpMessage(level);
  return [
    "🎉 Звёздный курс пройден — ты на уровне " + level + "!",
    message.title + ". " + message.text + ".",
    "На сайте уже открыты задания нового уровня. Прошлые задания остались в архиве — их можно пересмотреть.",
    link ? "Открыть: " + link : "",
  ].filter(Boolean).join("\n");
}

/** A participant left a review: the mentor sees who, the stars and the beginning of the text. */
export function reviewNoticeText(author: string, rating: number, body: string, link: string) {
  const text = body.trim();
  return [
    "⭐ Новый отзыв от " + author.trim().slice(0, 120) + ": " + "★".repeat(Math.max(1, Math.min(5, rating))),
    "«" + (text.length > 300 ? text.slice(0, 300).trimEnd() + "…" : text) + "»",
    link ? "Открыть отзывы: " + link : "",
  ].filter(Boolean).join("\n");
}

export function scheduleTelegramDelivery() {
  after(async () => {
    try { await deliverTelegramNotifications(); }
    catch { console.error("Telegram notification worker failed; queued jobs will be retried"); }
  });
}

/** A persisted queue is shared by webhook, role changes and the periodic delivery endpoint. */
export async function deliverTelegramNotifications() {
  const supabase = getSupabaseAdmin();
  if (!supabase || !serverEnv.telegramBotToken) return { unavailable: true as const };
  let delivered = 0;
  let failed = 0;
  const started = Date.now();
  for (let count = 0; count < JOBS_PER_RUN && Date.now() - started < 40_000; count++) {
    const claimed = await supabase.rpc("tg_claim_notification");
    if (claimed.error) throw new Error("Cannot claim Telegram notification");
    const job = claimed.data?.[0] as NotificationJob | undefined;
    if (!job) break;
    const save = async (patch: Record<string, unknown>) => {
      const result = await supabase.from("telegram_notification_jobs").update(patch).eq("id", job.id).eq("lock_token", job.lock_token);
      if (result.error) throw new Error("Cannot update Telegram notification");
    };
    try {
      const recipient = await supabase.from("users").select("id,role,team_id,telegram_id,can_review,can_publish_tasks").eq("id", job.recipient_id).maybeSingle();
      if (recipient.error || !recipient.data?.telegram_id) throw new Error("Recipient unavailable");
      const user = recipient.data;
      const chatId = String(user.telegram_id);
      let delivery: DeliveryResult;
      if (job.kind === "feedback") {
        const event = await supabase.from("feedback_events").select("thread_id,kind,author_user_id").eq("seq", job.feedback_event_seq).maybeSingle();
        if (event.error || !event.data) throw new Error("Cannot load feedback event");
        const allowed = await supabase.rpc("app_feedback_can_access", { p_thread: event.data.thread_id, p_actor: user.id, p_ceo: false });
        if (allowed.error) throw new Error("Cannot verify feedback access");
        if (!allowed.data || event.data.author_user_id === user.id) {
          await save({ cancelled_at: new Date().toISOString(), locked_until: null });
          continue;
        }
        const link = appUrl() ? appUrl() + (user.role === "admin" || user.can_review ? "/admin" : "/") + "?feedback=" + encodeURIComponent(event.data.thread_id) : "";
        delivery = await sendTelegramMessage(chatId, [
          event.data.kind === "review" ? "По вашей работе есть решение наставника." : "У вас новое сообщение по заданию.",
          link ? "Открыть обратную связь: " + link : "Откройте раздел «Обратная связь» на сайте.",
        ].join("\n"));
      } else if (job.kind === "task-reminder") {
        const taskId = String(job.payload.taskId || "");
        // Re-check at send time: the participant may have sent the work or reopened the link since queueing.
        const due = await supabase.rpc("app_task_reminder_due", { p_user: user.id, p_task: taskId });
        if (due.error) throw new Error("Cannot verify task reminder");
        if (!due.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        const task = await supabase.from("tasks").select("title").eq("id", taskId).maybeSingle();
        if (task.error || !task.data) throw new Error("Cannot load reminder task");
        delivery = await sendTelegramMessage(chatId, [
          "⏰ Напоминание по заданию «" + String(task.data.title || "Задание").slice(0, 200) + "»",
          "Вы открыли материал задания больше часа назад, но работа ещё не отправлена.",
          "Если вы уже всё выполнили, нажмите «Отправить ответ» в задании. Без этого наставник не сможет дать обратную связь и начислить мили.",
          appUrl() ? "Открыть задания: " + appUrl() + "/" : "",
        ].filter(Boolean).join("\n"));
      } else if (job.kind === "task-nudge") {
        const taskId = String(job.payload.taskId || "");
        // The participant may have answered, or the deadline passed, since the mentor pressed the button.
        const due = await supabase.rpc("app_task_nudge_due", { p_user: user.id, p_task: taskId });
        if (due.error) throw new Error("Cannot verify task nudge");
        if (!due.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        const task = await supabase.from("tasks").select("title,deadline_at").eq("id", taskId).maybeSingle();
        if (task.error || !task.data) throw new Error("Cannot load nudge task");
        delivery = await sendTelegramMessage(chatId, [
          "📌 Наставник напоминает о задании «" + String(task.data.title || "Задание").slice(0, 200) + "»",
          "Вы ещё не отправили ответ." + (task.data.deadline_at ? " Срок — до " + almatyDateTime.format(new Date(String(task.data.deadline_at))) + "." : ""),
          appUrl() ? "Открыть задания: " + appUrl() + "/?tab=tasks" : "",
        ].filter(Boolean).join("\n"));
      } else if (job.kind === "announcement") {
        const announcementId = String(job.payload.announcementId || "");
        const allowed = await supabase.rpc("app_announcement_recipient_ok", { p_user: user.id, p_announcement: announcementId });
        if (allowed.error) throw new Error("Cannot verify announcement recipient");
        if (!allowed.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        const announcement = await supabase.from("announcements").select("title,content,resource_url,photos,teams(name)").eq("id", announcementId).maybeSingle();
        if (announcement.error || !announcement.data) throw new Error("Cannot load announcement");
        const item = announcement.data;
        const team = Array.isArray(item.teams) ? item.teams[0] : item.teams;
        const content = String(item.content || "");
        // Paragraphs separated by an empty line; the text is trimmed to stay within Telegram's limit.
        delivery = await sendTelegramMessage(chatId, [
          "📢 Объявление" + (team?.name ? " команды «" + String(team.name).slice(0, 120) + "»" : ""),
          String(item.title || "").slice(0, 200),
          content.length > 3000 ? content.slice(0, 3000).trimEnd() + "…" : content,
          item.resource_url ? "Ссылка: " + String(item.resource_url) : "",
          Array.isArray(item.photos) && item.photos.length ? "Фото — в объявлении на сайте." : "",
          appUrl() ? "Открыть на сайте: " + appUrl() + "/" : "",
        ].filter(Boolean).join("\n\n"));
      } else if (job.kind === "start-reminder") {
        const due = await supabase.rpc("app_start_reminder_due", { p_user: user.id });
        if (due.error) throw new Error("Cannot verify start reminder");
        if (!due.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        const profile = await supabase.from("users").select("first_name,name,teams(name)").eq("id", user.id).maybeSingle();
        if (profile.error || !profile.data) throw new Error("Cannot load reminder recipient");
        const team = Array.isArray(profile.data.teams) ? profile.data.teams[0] : profile.data.teams;
        delivery = await sendTelegramMessage(chatId, startReminderText(Number(job.payload.step || 1), String(profile.data.first_name || ""), String(team?.name || ""), appUrl() ? appUrl() + "/?tab=tasks" : ""));
      } else if (job.kind === "review") {
        // The review may have been deleted while the message waited in the queue.
        const review = await supabase.from("reviews").select("rating,body,users(name)").eq("id", String(job.payload.reviewId || "")).maybeSingle();
        if (review.error) throw new Error("Cannot load review");
        if (!review.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        const author = Array.isArray(review.data.users) ? review.data.users[0] : review.data.users;
        delivery = await sendTelegramMessage(chatId, reviewNoticeText(String(author?.name || "Участник"), Number(review.data.rating || 0), String(review.data.body || ""), appUrl() ? appUrl() + "/admin?section=reviews" : ""));
      } else if (job.kind === "submission-timeout") {
        // Nothing to say if the answer came, the participant took a new link, or the task is gone.
        const session = await supabase.from("telegram_submission_sessions").select("user_id,task_id,consumed_at,created_at,metadata,tasks(title,voice_answer)").eq("token_hash", String(job.payload.session || "")).maybeSingle();
        if (session.error) throw new Error("Cannot load submission session");
        let stale = !session.data || Boolean(session.data.consumed_at);
        if (!stale && session.data) {
          const newer = await supabase.from("telegram_submission_sessions").select("token_hash").eq("user_id", session.data.user_id).eq("task_id", session.data.task_id).gt("created_at", session.data.created_at).limit(1);
          if (newer.error) throw new Error("Cannot check newer submission sessions");
          stale = Boolean(newer.data?.length);
        }
        if (stale || !session.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        const task = (Array.isArray(session.data.tasks) ? session.data.tasks[0] : session.data.tasks) as { title?: string; voice_answer?: boolean } | null;
        const metadata = (session.data.metadata || {}) as Record<string, unknown>;
        delivery = await sendTelegramMessage(chatId, submissionTimeoutText(String(task?.title || ""), task?.voice_answer === true, Boolean(metadata.quiz), appUrl() ? appUrl() + "/?tab=tasks" : ""));
      } else if (job.kind === "level-up") {
        // A mentor may have returned the participant to the previous level while the message waited.
        const memberId = job.payload.memberId ? String(job.payload.memberId) : user.id;
        const level = Number(job.payload.level || 2);
        const current = await supabase.rpc("app_member_level", { p_user: memberId });
        if (current.error) throw new Error("Cannot verify member level");
        if (Number(current.data) < level) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        let memberName: string | null = null;
        if (job.payload.memberId) {
          const member = await supabase.from("users").select("name").eq("id", memberId).maybeSingle();
          if (member.error) throw new Error("Cannot load member");
          memberName = String(member.data?.name || "Участник");
        }
        delivery = await sendTelegramMessage(chatId, levelUpText(level, memberName, appUrl() ? appUrl() + (memberName === null ? "/" : "/admin?section=network") : ""));
      } else if (job.kind === "miles-recount") {
        delivery = await sendTelegramMessage(chatId, milesRecountText(String(job.payload.title || ""), Number(job.payload.from || 0), Number(job.payload.to || 0), appUrl() ? appUrl() + "/" : ""));
      } else if (job.kind === "permissions") {
        const review = job.payload.canReview && (user.role === "admin" || user.can_review);
        const publish = job.payload.canPublishTasks && (user.role === "admin" || user.can_publish_tasks);
        if (!user.team_id || (!review && !publish)) {
          await save({ cancelled_at: new Date().toISOString(), locked_until: null });
          continue;
        }
        delivery = await sendTelegramMessage(chatId, [
          "Вам выданы новые возможности:",
          review ? "✓ Проверять работы участников своей ветки на всех уровнях." : "",
          publish ? "✓ Публиковать задания." : "",
          review ? "Новые и ожидающие проверки работы вашей ветки будут приходить сюда." : "",
          appUrl() ? "Панель наставника: " + appUrl() + "/admin" : "",
        ].filter(Boolean).join("\n"));
      } else if (job.kind === "survey") {
        const allowed = await supabase.rpc("tg_can_receive_survey", { p_recipient: user.id, p_submission: job.submission_id });
        if (allowed.error) throw new Error("Cannot verify survey recipient access");
        if (!allowed.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        const result = await supabase.from("submissions").select("answer_text").eq("id", job.submission_id).maybeSingle();
        if (result.error || !result.data?.answer_text) throw new Error("Cannot load survey answers");
        // One compact message fits Telegram's limit; no separate summary can duplicate.
        const text = String(result.data.answer_text);
        if (text.length > 4000) throw new Error("Survey message is too long");
        delivery = await sendTelegramMessage(chatId, text);
      } else if (job.kind === "captain-screenshot") {
        const checkAccess = () => supabase.rpc("tg_can_receive_captain_screenshot", { p_recipient: user.id, p_submission: job.submission_id });
        const allowed = await checkAccess();
        if (allowed.error) throw new Error("Cannot verify screenshot recipient access");
        if (!allowed.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        const result = await supabase.from("ready_program_attachments").select("summary,telegram_file_id,telegram_chat_id,telegram_message_id").eq("submission_id", job.submission_id).maybeSingle();
        if (result.error || !result.data?.telegram_file_id || !result.data.summary) throw new Error("Cannot load captain screenshot");
        const attachment = result.data;
        if (!job.summary_sent) {
          const summary = await sendTelegramMessage(chatId, String(attachment.summary));
          if (!summary.ok) throw new Error(summary.error);
          await save({ summary_sent: true });
        }
        const recheck = await checkAccess();
        if (recheck.error) throw new Error("Cannot recheck screenshot recipient access");
        if (!recheck.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        delivery = await copyTelegramMessage(chatId, String(attachment.telegram_chat_id), String(attachment.telegram_message_id));
        if (!delivery.ok) {
          const fallbackAccess = await checkAccess();
          if (fallbackAccess.error) throw new Error("Cannot verify fallback screenshot access");
          if (!fallbackAccess.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
          const response = await fetch(`https://api.telegram.org/bot${serverEnv.telegramBotToken}/sendPhoto`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, photo: attachment.telegram_file_id }), signal: AbortSignal.timeout(8_000),
          });
          const payload = await response.json() as TelegramApiResponse;
          delivery = response.ok && payload.ok ? { ok: true } : { ok: false, error: payload.description || "Screenshot delivery failed" };
        }
      } else if (job.kind === "company-voice") {
        const checkAccess = () => supabase.rpc("tg_can_receive_company_voice", { p_recipient: user.id, p_submission: job.submission_id });
        const allowed = await checkAccess();
        if (allowed.error) throw new Error("Cannot verify voice recipient access");
        if (!allowed.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        const result = await supabase.from("submissions").select("company_voice_chat_id,company_voice_message_id,company_voice_file_id,users(name),tasks(title)").eq("id", job.submission_id).maybeSingle();
        if (result.error || !result.data?.company_voice_file_id) throw new Error("Cannot load company voice");
        const voice = result.data;
        const participant = Array.isArray(voice.users) ? voice.users[0] : voice.users;
        const task = Array.isArray(voice.tasks) ? voice.tasks[0] : voice.tasks;
        if (!job.summary_sent) {
          const summary = await sendTelegramMessage(chatId, ["🎙️ Голосовое участника по заданию", "Участник: " + String(participant?.name || "Участник").slice(0, 200), "Задание: " + String(task?.title || "Готовое задание").slice(0, 200), "Мили за прохождение уже начислены. Голосовое — для обратной связи, не для повторной оценки."].join("\n"));
          if (!summary.ok) throw new Error(summary.error);
          await save({ summary_sent: true });
        }
        const recheck = await checkAccess();
        if (recheck.error) throw new Error("Cannot recheck voice recipient access");
        if (!recheck.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        delivery = await copyTelegramMessage(chatId, String(voice.company_voice_chat_id), String(voice.company_voice_message_id));
        if (!delivery.ok) {
          const fallbackAccess = await checkAccess();
          if (fallbackAccess.error) throw new Error("Cannot verify fallback voice access");
          if (!fallbackAccess.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
          // Reuse Telegram's file_id; no download or Supabase Storage copy.
          const response = await fetch(`https://api.telegram.org/bot${serverEnv.telegramBotToken}/sendVoice`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, voice: voice.company_voice_file_id }), signal: AbortSignal.timeout(8_000),
          });
          const payload = await response.json() as TelegramApiResponse;
          delivery = response.ok && payload.ok ? { ok: true } : { ok: false, error: payload.description || "Voice delivery failed" };
        }
      } else {
        const allowed = await supabase.rpc("tg_can_review", { p_reviewer: user.id, p_submission: job.submission_id });
        if (allowed.error) throw new Error("Cannot verify recipient access");
        const submission = await supabase.from("submissions")
          .select("id,status,telegram_chat_id,telegram_message_id,telegram_file_id,media_type,answer_text,users(name),tasks(title)")
          .eq("id", job.submission_id).maybeSingle();
        if (submission.error) throw new Error("Cannot load submission");
        if (!allowed.data || !submission.data || submission.data.status !== "pending") {
          await save({ cancelled_at: new Date().toISOString(), locked_until: null });
          continue;
        }
        const answer = submission.data;
        const participant = Array.isArray(answer.users) ? answer.users[0] : answer.users;
        const task = Array.isArray(answer.tasks) ? answer.tasks[0] : answer.tasks;
        const panelUrl = appUrl() ? appUrl() + "/admin?submission=" + encodeURIComponent(String(job.submission_id)) : "";
        if (!job.summary_sent) {
          const summary = await sendTelegramMessage(chatId, [
            "📥 Работа на проверку", "Участник: " + String(participant?.name || "Участник").slice(0, 200),
            "Задание: " + String(task?.title || "Задание").slice(0, 200),
            panelUrl ? "Открыть в панели: " + panelUrl : "",
          ].filter(Boolean).join("\n"));
          if (!summary.ok) throw new Error(summary.error);
          await save({ summary_sent: true });
        }
        // Re-check after sending the summary; no answer should follow a revoked permission.
        const recheck = await supabase.rpc("tg_can_review", { p_reviewer: user.id, p_submission: job.submission_id });
        if (recheck.error) throw new Error("Cannot verify recipient access");
        if (!recheck.data) { await save({ cancelled_at: new Date().toISOString(), locked_until: null }); continue; }
        delivery = answer.telegram_chat_id && answer.telegram_message_id
          ? await copyTelegramMessage(chatId, String(answer.telegram_chat_id), String(answer.telegram_message_id))
          : { ok: false, error: "Original message unavailable" };
        if (!delivery.ok && answer.media_type === "text" && answer.answer_text) {
          delivery = { ok: true };
          const content = String(answer.answer_text);
          for (let offset = 0; offset < content.length; offset += 3500) {
            delivery = await sendTelegramMessage(chatId, content.slice(offset, offset + 3500));
            if (!delivery.ok) break;
          }
        }
        if (!delivery.ok && answer.telegram_file_id && ["photo", "video", "document", "voice"].includes(String(answer.media_type))) {
          const type = String(answer.media_type);
          const method = type === "photo" ? "sendPhoto" : type === "video" ? "sendVideo" : type === "voice" ? "sendVoice" : "sendDocument";
          const response = await fetch(`https://api.telegram.org/bot${serverEnv.telegramBotToken}/${method}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, [type]: answer.telegram_file_id, caption: String(answer.answer_text || "").slice(0, 1024) }),
            signal: AbortSignal.timeout(8_000),
          });
          const payload = await response.json() as TelegramApiResponse;
          delivery = response.ok && payload.ok ? { ok: true } : { ok: false, error: payload.description || "Media delivery failed" };
        }
      }
      if (!delivery.ok) throw new Error(delivery.error);
      await save({ delivered_at: new Date().toISOString(), locked_until: null, last_error: null });
      delivered++;
    } catch (error) {
      failed++;
      await save({
        locked_until: null,
        available_at: new Date(Date.now() + Math.min(3600, 30 * 2 ** Math.min(job.attempts, 7)) * 1000).toISOString(),
        last_error: errorText(error).slice(0, 300),
      });
      console.warn("Telegram notification delayed", { jobId: job.id });
    }
  }
  // Existing jobs go first; reminders queued here are sent by the next run, at most a minute later.
  // A reminder problem must never turn a successful delivery run into a failure.
  try {
    const reminders = await supabase.rpc("app_queue_task_reminders", {});
    if (reminders.error) console.warn("Task reminders were not queued", { code: reminders.error.code });
  } catch { console.warn("Task reminders were not queued"); }
  if (isAlmatyDaytime()) {
    try {
      const starters = await supabase.rpc("app_queue_start_reminders", {});
      if (starters.error) console.warn("Start reminders were not queued", { code: starters.error.code });
    } catch { console.warn("Start reminders were not queued"); }
  }
  return { delivered, failed };
}
