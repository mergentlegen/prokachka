import { feedbackDetail, feedbackMessage } from "@/backend/controllers/feedback.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return feedbackDetail(request, (await context.params).id); }
export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "feedback-message", { max: 30, windowMs: 60_000, maxBodyBytes: 8_192 });
  if (blocked) return blocked;
  return feedbackMessage(request, (await context.params).id);
}
