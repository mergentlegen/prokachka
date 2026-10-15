import { feedbackDismiss } from "@/backend/controllers/feedback.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "feedback-dismiss", { max: 60, windowMs: 60_000, maxBodyBytes: 0 });
  if (blocked) return blocked;
  return feedbackDismiss(request, (await context.params).id);
}
