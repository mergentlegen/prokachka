import { feedbackRead } from "@/backend/controllers/feedback.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "feedback-read", { max: 120, windowMs: 60_000, maxBodyBytes: 0 });
  if (blocked) return blocked;
  return feedbackRead(request, (await context.params).id);
}
