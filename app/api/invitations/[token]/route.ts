import { previewInvitation } from "@/backend/controllers/invitation-preview.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ token: string }> };
export async function GET(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "invitation-preview", { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  return previewInvitation((await context.params).token);
}
