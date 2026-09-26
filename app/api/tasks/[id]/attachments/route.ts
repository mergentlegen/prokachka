import { createTaskAttachment } from "@/backend/controllers/task-attachments.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-attachment-upload", { max: 30, windowMs: 60_000, maxBodyBytes: 16 * 1024 * 1024 });
  if (blocked) return blocked;
  return createTaskAttachment(request, (await context.params).id);
}
