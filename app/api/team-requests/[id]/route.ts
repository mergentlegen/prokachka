import { reviewTeamRequest } from "@/backend/controllers/team-requests.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "team-requests-review", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return reviewTeamRequest(request, (await context.params).id);
}