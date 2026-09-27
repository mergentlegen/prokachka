import { taskOrder } from "@/backend/controllers/task-feed-order.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) { return taskOrder(request); }
export async function PUT(request: Request) {
  const blocked = enforceRequestSecurity(request, "task-feed-order", { max: 30, windowMs: 60_000, maxBodyBytes: 128 * 1024 });
  return blocked || taskOrder(request);
}
