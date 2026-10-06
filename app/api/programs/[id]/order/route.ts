import { reorderProgramSteps } from "@/backend/controllers/program-steps.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "programs-order", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return reorderProgramSteps(request, (await context.params).id);
}
