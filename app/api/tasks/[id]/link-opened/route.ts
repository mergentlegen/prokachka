import { taskLinkOpened } from "@/backend/controllers/task-reminders.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-link-opened", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return taskLinkOpened(request, (await context.params).id);
}
