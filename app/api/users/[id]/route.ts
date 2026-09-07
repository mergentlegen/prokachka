import { updateUserAccessController } from "@/backend/controllers/users.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "users-update", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return updateUserAccessController(request, (await context.params).id);
}