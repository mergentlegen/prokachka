import { permanentlyDeleteTeamController } from "@/backend/controllers/teams.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "teams-permanent-delete", { max: 10, windowMs: 60_000 });
  if (blocked) return blocked;
  return permanentlyDeleteTeamController(request, (await context.params).id);
}
