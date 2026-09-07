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
  return error instanceof Error ? error.message : String(error);
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

/** Notifies every linked mentor of the participant's new submission. */
export async function notifyMentorsAboutSubmission(submissionId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const submissionResult = await supabase
    .from("submissions")
    .select("id,user_id,task_id,submitted_at")
    .eq("id", submissionId)
    .single();
  if (submissionResult.error || !submissionResult.data) {
    return { error: submissionResult.error || new Error("Submission not found") };
  }

  const [userResult, taskResult] = await Promise.all([
    supabase.from("users").select("id,name,team_id").eq("id", submissionResult.data.user_id).single(),
    supabase.from("tasks").select("id,title,team_id").eq("id", submissionResult.data.task_id).single(),
  ]);
  if (userResult.error || !userResult.data) return { error: userResult.error || new Error("Participant not found") };
  if (taskResult.error || !taskResult.data) return { error: taskResult.error || new Error("Task not found") };

  const teamId = userResult.data.team_id ? String(userResult.data.team_id) : "";
  if (!teamId || String(taskResult.data.team_id || "") !== teamId) {
    return { error: new Error("Participant and task belong to different teams") };
  }

  const mentorsResult = await supabase
    .from("users")
    .select("id,name,telegram_id")
    .eq("team_id", teamId)
    .eq("role", "admin");
  if (mentorsResult.error) return { error: mentorsResult.error };

  const mentors = (mentorsResult.data || []).filter((mentor) => Boolean(String(mentor.telegram_id || "").trim()));
  if (mentors.length === 0) {
    console.warn("No linked mentors found for Telegram submission", { submissionId, teamId });
    return { delivered: 0, failed: 0, mentors: 0, reason: "no_linked_mentors" as const };
  }

  const baseUrl = appUrl();
  const panelUrl = baseUrl ? `${baseUrl}/admin?submission=${encodeURIComponent(submissionId)}` : "";
  const text = [
    "📥 Новая работа на проверку",
    "",
    `Участник: ${String(userResult.data.name || "Без имени")}`,
    `Задание: ${String(taskResult.data.title || "Без названия")}`,
    `Получено: ${new Date(String(submissionResult.data.submitted_at)).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}`,
    panelUrl ? `\nОткрыть панель: ${panelUrl}` : "",
  ].filter(Boolean).join("\n");

  const deliveries = await Promise.all(
    mentors.map(async (mentor) => sendTelegramMessage(String(mentor.telegram_id), text)),
  );
  const delivered = deliveries.filter((result) => result.ok).length;
  const failed = deliveries.length - delivered;
  console.info("Telegram mentor notification completed", { submissionId, teamId, mentors: mentors.length, delivered, failed });
  return { delivered, failed, mentors: mentors.length };
}
