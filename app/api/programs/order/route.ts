import { putProgramOrder } from "@/backend/controllers/programs.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function PUT(request: Request) {
  const blocked = enforceRequestSecurity(request, "programs-list-order", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return putProgramOrder(request);
}
