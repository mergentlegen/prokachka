import { confirmEmail } from "@/backend/controllers/auth.controller";
import { withAuthCookie } from "@/backend/http/auth-response";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "auth-verify-email", { max: 20, windowMs: 10 * 60_000, maxBodyBytes: 4096 });
  if (blocked) return blocked;
  return withAuthCookie(await confirmEmail(request));
}
