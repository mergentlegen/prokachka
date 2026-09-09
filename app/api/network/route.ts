import { createInvitation, listNetwork } from "@/backend/controllers/network.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) {
  return listNetwork(request);
}

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "network-invitation", { max: 10, windowMs: 60 * 60_000 });
  if (blocked) return blocked;
  return createInvitation(request);
}
