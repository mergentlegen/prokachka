import type { Team, TeamJoinRequest } from "@/shared/domain/types";
import { request } from "@/frontend/shared/api/client";

type ApiRow = Record<string, unknown>;
type ApiResponse<T> = { ok: boolean; message?: string } & T;

export function mapTeam(row: ApiRow): Team {
  return { id: String(row.id), name: String(row.name || ""), description: String(row.description || ""), isActive: Boolean(row.is_active), createdAt: String(row.created_at || "") };
}

function mapRequest(row: ApiRow): TeamJoinRequest {
  const user = Array.isArray(row.users) ? row.users[0] : row.users;
  const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
  return { id: String(row.id), userId: String(row.user_id), teamId: String(row.team_id), status: row.status === "approved" || row.status === "rejected" ? row.status : "pending", createdAt: String(row.created_at || ""), reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined, invitedByUserId: row.invited_by_user_id ? String(row.invited_by_user_id) : undefined, userName: user && typeof user === "object" ? String((user as { name?: unknown }).name || "") : undefined, teamName: team && typeof team === "object" ? String((team as { name?: unknown }).name || "") : undefined };
}

export async function loadTeamSelection() {
  const [teamsResponse, requestsResponse] = await Promise.all([
    request<ApiResponse<{ teams: ApiRow[] }>>("/api/teams"),
    request<ApiResponse<{ requests: ApiRow[] }>>("/api/team-requests"),
  ]);
  return { teams: teamsResponse.teams.map(mapTeam), requests: requestsResponse.requests.map(mapRequest) };
}

export async function submitTeamJoinRequest(teamId: string, inviteToken?: string) {
  const response = await request<ApiResponse<{ request: ApiRow }>>("/api/team-requests", { method: "POST", body: JSON.stringify({ teamId, inviteToken }) });
  return mapRequest(response.request);
}

export async function loadTeamRequests() {
  const response = await request<ApiResponse<{ requests: ApiRow[] }>>("/api/team-requests");
  return response.requests.map(mapRequest);
}

export async function reviewTeamJoinRequest(id: string, status: "approved" | "rejected") {
  const response = await request<ApiResponse<{ request: ApiRow }>>(`/api/team-requests/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  return mapRequest(response.request);
}

export async function createTeam(input: { name: string; description: string }) {
  const response = await request<ApiResponse<{ team: ApiRow }>>("/api/teams", { method: "POST", body: JSON.stringify(input) });
  return mapTeam(response.team);
}

export async function updateTeam(id: string, input: { name?: string; description?: string; isActive?: boolean }) {
  const response = await request<ApiResponse<{ team: ApiRow }>>(`/api/teams/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  return mapTeam(response.team);
}
