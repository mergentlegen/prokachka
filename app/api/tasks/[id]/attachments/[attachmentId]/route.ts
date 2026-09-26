import { removeTaskAttachment, readTaskAttachment } from "@/backend/controllers/task-attachments.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string; attachmentId: string }> };
export async function GET(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-attachment-read", { max: 120, windowMs: 60_000 });
  if (blocked) return blocked;
  const { id, attachmentId } = await context.params;
  return readTaskAttachment(request, id, attachmentId);
}
export async function DELETE(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-attachment-delete", { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  const { id, attachmentId } = await context.params;
  return removeTaskAttachment(request, id, attachmentId);
}
