import { startTelegram } from "@/backend/controllers/telegram.controller";

export async function GET(request: Request) {
  return startTelegram(request);
}
