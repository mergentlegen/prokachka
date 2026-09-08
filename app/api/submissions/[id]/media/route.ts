import { streamSubmissionMedia } from "@/backend/controllers/submissions.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "submissions-media", { max: 120, windowMs: 60_000 });
  if (blocked) return blocked;
  return streamSubmissionMedia(request, (await context.params).id);
}
