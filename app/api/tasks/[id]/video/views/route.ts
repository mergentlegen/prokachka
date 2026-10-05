import { readTaskVideoViews } from "@/backend/controllers/task-quizzes.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-video-views", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return readTaskVideoViews(request, (await context.params).id);
}
