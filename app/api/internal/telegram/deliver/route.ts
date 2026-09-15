import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/backend/config/env";
import { failure, ok } from "@/backend/http/api-response";
import { deliverTelegramNotifications } from "@/backend/services/telegram-notifications.service";

export async function POST(request: Request) {
  const secret = serverEnv.telegramDeliverySecret;
  const supplied = request.headers.get("authorization") || "";
  const expected = "Bearer " + (secret || "");
  if (!secret || secret.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return failure("Доступ запрещён.", 401);
  try {
    const result = await deliverTelegramNotifications();
    if ("unavailable" in result) return failure("Доставка не настроена.", 503);
    return ok(result);
  } catch { return failure("Не удалось обработать очередь.", 503); }
}
