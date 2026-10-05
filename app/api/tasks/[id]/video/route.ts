import { completeTaskVideoUpload, deleteTaskVideo, readTaskVideo } from "@/backend/controllers/task-videos.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-video", { max: 120, windowMs: 60_000 });
  if (blocked) return blocked;
  return readTaskVideo(request, (await context.params).id);
}
export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-video-save", { max: 20, windowMs: 60_000 });
  if (blocked) return blocked;
  return completeTaskVideoUpload(request, (await context.params).id);
}
export async function DELETE(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-video-save", { max: 20, windowMs: 60_000 });
  if (blocked) return blocked;
  return deleteTaskVideo(request, (await context.params).id);
}
