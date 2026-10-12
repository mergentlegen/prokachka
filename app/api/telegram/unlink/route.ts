import { unlinkTelegram } from "@/backend/controllers/profile.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "telegram-unlink", { max: 10 });
  return blocked || unlinkTelegram(request);
}
