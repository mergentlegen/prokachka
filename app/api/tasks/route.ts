import { createTask, listTasks } from "@/backend/controllers/tasks.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) { return listTasks(request); }
export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "tasks-create", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return createTask(request);
}