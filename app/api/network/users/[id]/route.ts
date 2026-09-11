import { patchNetworkUser } from "@/backend/controllers/network.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "network-user-update", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return patchNetworkUser(request, (await context.params).id);
}
