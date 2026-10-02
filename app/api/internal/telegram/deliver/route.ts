import { failure, ok } from "@/backend/http/api-response";
import { isInternalRequest } from "@/backend/http/internal-auth";
import { deliverTelegramNotifications } from "@/backend/services/telegram-notifications.service";

export async function POST(request: Request) {
  if (!isInternalRequest(request)) return failure("Доступ запрещён.", 401);
  try {
    const result = await deliverTelegramNotifications();
    if ("unavailable" in result) return failure("Доставка не настроена.", 503);
    return ok(result);
  } catch { return failure("Не удалось обработать очередь.", 503); }
}
