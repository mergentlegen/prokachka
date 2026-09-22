import { telegramLinkStatus } from "@/backend/controllers/telegram.controller";

export async function GET(request: Request) {
  return telegramLinkStatus(request);
}
