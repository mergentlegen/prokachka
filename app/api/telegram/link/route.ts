import { createTelegramLink } from "@/backend/controllers/telegram.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "telegram-link", { max: 5, windowMs: 10 * 60_000 });
  if (blocked) return blocked;
  return createTelegramLink(request);
}