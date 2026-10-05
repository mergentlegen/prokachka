import { saveTaskVideoProgress } from "@/backend/controllers/task-videos.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-video-progress", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return saveTaskVideoProgress(request, (await context.params).id);
}
