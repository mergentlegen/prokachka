import { readTaskAttachment } from "@/backend/controllers/task-attachments.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

// The trailing file name only makes the browser tab and "Save as" show the real PDF name; access is still checked by ids.
type Context = { params: Promise<{ id: string; attachmentId: string; fileName: string }> };
export async function GET(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-attachment-read", { max: 120, windowMs: 60_000 });
  if (blocked) return blocked;
  const { id, attachmentId } = await context.params;
  return readTaskAttachment(request, id, attachmentId);
}
