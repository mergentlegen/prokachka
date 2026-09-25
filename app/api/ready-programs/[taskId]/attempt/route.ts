import { postReadyProgramAttempt } from "@/backend/controllers/ready-program-attempts.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ taskId: string }> };

export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "ready-program-attempt", { max: 120, windowMs: 60_000 });
  if (blocked) return blocked;
  return postReadyProgramAttempt(request, (await context.params).taskId);
}
