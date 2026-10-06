import { addProgramGame } from "@/backend/controllers/program-steps.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "programs-game", { max: 20, windowMs: 60_000 });
  if (blocked) return blocked;
  return addProgramGame(request, (await context.params).id);
}
