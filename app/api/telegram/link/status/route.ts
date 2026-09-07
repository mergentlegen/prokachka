import { telegramLinkStatus } from "@/backend/controllers/telegram.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) {
  return telegramLinkStatus(request);
}