import { register } from "@/backend/controllers/auth.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
import { withAuthCookie } from "@/backend/http/auth-response";

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "auth-register", { max: 5, windowMs: 10 * 60_000, maxBodyBytes: 16 * 1024 });
  if (blocked) return blocked;
  return withAuthCookie(await register(request));
}
