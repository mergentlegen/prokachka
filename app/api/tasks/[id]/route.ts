import { deleteTask, updateTask } from "@/backend/controllers/tasks.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "tasks-update", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return updateTask(request, (await context.params).id);
}
export async function DELETE(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "tasks-delete", { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  return deleteTask(request, (await context.params).id);
}