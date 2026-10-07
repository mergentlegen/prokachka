import { addProgramStep } from "@/backend/controllers/program-steps.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "programs-step", { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  return addProgramStep(request, (await context.params).id);
}
