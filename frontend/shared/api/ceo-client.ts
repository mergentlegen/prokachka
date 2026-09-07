import type { Team, TeamJoinRequest, User } from "@/shared/domain/types";
import { mapUser, request } from "@/frontend/shared/api/client";
import { loadTeamRequests, mapTeam } from "@/frontend/shared/api/team-client";

type ApiRow = Record<string, unknown>;
type ApiResponse<T> = { ok: boolean; message?: string } & T;

export { loadTeamRequests };

export async function loadCeoData() {
  const [teamsResponse, usersResponse, requestsResponse] = await Promise.all([
    request<ApiResponse<{ teams: ApiRow[] }>>("/api/teams"),
    request<ApiResponse<{ users: ApiRow[] }>>("/api/users"),
    request<ApiResponse<{ requests: ApiRow[] }>>("/api/team-requests"),
  ]);
  return { teams: teamsResponse.teams.map(mapTeam), users: usersResponse.users.map(mapUser), requests: requestsResponse.requests.map((row) => ({ id: String(row.id), userId: String(row.user_id), teamId: String(row.team_id), status: row.status === "approved" || row.status === "rejected" ? row.status : "pending", createdAt: String(row.created_at || ""), reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined, userName: Array.isArray(row.users) ? String((row.users[0] as ApiRow)?.name || "") : String((row.users as ApiRow)?.name || ""), teamName: Array.isArray(row.teams) ? String((row.teams[0] as ApiRow)?.name || "") : String((row.teams as ApiRow)?.name || "") })) as TeamJoinRequest[] };
}

export async function createCeoTeam(input: { name: string; description: string }) {
  const response = await request<ApiResponse<{ team: ApiRow }>>("/api/teams", { method: "POST", body: JSON.stringify(input) });
  return mapTeam(response.team);
}

export async function updateCeoTeam(id: string, input: { name?: string; description?: string; isActive?: boolean }) {
  const response = await request<ApiResponse<{ team: ApiRow }>>(`/api/teams/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  return mapTeam(response.team);
}

export async function updateCeoUser(id: string, input: { role: "admin" | "member"; teamId: string | null }) {
  const response = await request<ApiResponse<{ user: ApiRow }>>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  return mapUser(response.user);
}

export async function reviewCeoRequest(id: string, status: "approved" | "rejected") {
  const response = await request<ApiResponse<{ request: ApiRow }>>(`/api/team-requests/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  return response;
}