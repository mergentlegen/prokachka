import { requestRecovery } from "@/backend/controllers/password-recovery.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
import { withAuthCookie } from "@/backend/http/auth-response";

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "password-recovery-send", { max: 10, windowMs: 60 * 60_000, maxBodyBytes: 4096 });
  if (blocked) return blocked;
  return withAuthCookie(await requestRecovery(request));
}
