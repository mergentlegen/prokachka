import { previewTaskNudge, sendTaskNudge } from "@/backend/controllers/task-nudges.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return previewTaskNudge(request, (await context.params).id);
}
export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-nudge", { max: 10, windowMs: 60_000 });
  if (blocked) return blocked;
  return sendTaskNudge(request, (await context.params).id);
}
