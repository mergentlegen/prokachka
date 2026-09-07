import { createTeamController, listTeams } from "@/backend/controllers/teams.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) { return listTeams(request); }
export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "teams-create", { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  return createTeamController(request);
}