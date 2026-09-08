import { deleteProgramController, patchProgram } from "@/backend/controllers/programs.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "programs-update", { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  return patchProgram(request, (await context.params).id);
}

export async function DELETE(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "programs-delete", { max: 20, windowMs: 60_000 });
  if (blocked) return blocked;
  return deleteProgramController(request, (await context.params).id);
}
