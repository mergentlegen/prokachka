import { deleteStarAward } from "@/backend/controllers/stars.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "stars-delete", { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  return deleteStarAward(request, (await context.params).id);
}
