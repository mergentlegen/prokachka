import { createTeamRequest, listTeamRequests } from "@/backend/controllers/team-requests.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) { return listTeamRequests(request); }
export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "team-requests-create", { max: 10, windowMs: 10 * 60_000 });
  if (blocked) return blocked;
  return createTeamRequest(request);
}