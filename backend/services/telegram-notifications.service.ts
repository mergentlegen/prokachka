import { after } from "next/server";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { serverEnv } from "@/backend/config/env";

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
  id: string; recipient_id: string; submission_id: string | null; kind: "permissions" | "submission";
  payload: { canReview?: boolean; canPublishTasks?: boolean }; summary_sent: boolean; attempts: number; lock_token: string;
};

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
  for (let count = 0; count < 10 && Date.now() - started < 20_000; count++) {
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
      if (job.kind === "permissions") {
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
        if (!delivery.ok && answer.telegram_file_id && ["photo", "video", "document"].includes(String(answer.media_type))) {
          const type = String(answer.media_type);
          const method = type === "photo" ? "sendPhoto" : type === "video" ? "sendVideo" : "sendDocument";
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
  return { delivered, failed };
}
