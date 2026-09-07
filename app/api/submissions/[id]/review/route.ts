import { reviewSubmission } from "@/backend/controllers/submissions.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "submissions-review", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return reviewSubmission(request, (await context.params).id);
}