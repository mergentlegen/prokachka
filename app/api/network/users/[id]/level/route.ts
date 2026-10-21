import { patchMemberLevel } from "@/backend/controllers/network.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "member-level", { max: 30, windowMs: 60_000, maxBodyBytes: 1_024 });
  if (blocked) return blocked;
  return patchMemberLevel(request, (await context.params).id);
}
