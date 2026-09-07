import { receiveTelegramUpdate } from "@/backend/controllers/telegram.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "telegram-webhook", { max: 180, windowMs: 60_000, maxBodyBytes: 512 * 1024, skipOrigin: true });
  if (blocked) return blocked;
  return receiveTelegramUpdate(request);
}