import { patchProgram } from "@/backend/controllers/programs.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "programs-update", { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  return patchProgram(request, (await context.params).id);
}
