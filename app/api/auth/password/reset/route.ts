import { resetPassword } from "@/backend/controllers/password-recovery.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
import { withAuthCookie } from "@/backend/http/auth-response";

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "password-recovery-reset", { max: 10, windowMs: 10 * 60_000, maxBodyBytes: 16 * 1024 });
  if (blocked) return blocked;
  return withAuthCookie(await resetPassword(request));
}
