import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

// The process-local/IP guard is the first barrier. This counter survives restarts
// and protects the same account across multiple IP addresses and server workers.
export async function checkLoginAttempt(email: string) {
  const unavailable = { error: "Сервис авторизации временно недоступен. Попробуйте позже.", status: 503 };
  const client = getSupabaseAdmin();
  if (!client) return process.env.NODE_ENV === "production" ? unavailable : null;
  try {
    const emailHash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
    const { data, error } = await client.rpc("app_login_attempt_limit", { p_email_hash: emailHash });
    if (error || typeof data?.allowed !== "boolean") return unavailable;
    if (!data.allowed) return {
      error: "Слишком много попыток входа. Подождите 15 минут или восстановите пароль.",
      status: 429,
      retryAfter: Math.max(1, Math.min(900, Number(data.retryAfter) || 900)),
    };
    return null;
  } catch { return unavailable; }
}
