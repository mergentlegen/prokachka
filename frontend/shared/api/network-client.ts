import type { User } from "@/shared/domain/types";
import { mapUser, request } from "@/frontend/shared/api/client";

type ApiRow = Record<string, unknown>;
type ApiResponse<T> = { ok: boolean; message?: string } & T;

export async function loadNetwork(): Promise<User[]> {
  const response = await request<ApiResponse<{ users: ApiRow[] }>>("/api/network");
  return response.users.map(mapUser);
}

export async function createNetworkInvitation(): Promise<{ url: string; expiresAt: string }> {
  const response = await request<ApiResponse<{ invitation: { url: string; expires_at: string } }>>("/api/network", { method: "POST", body: JSON.stringify({}) });
  return { url: response.invitation.url, expiresAt: response.invitation.expires_at };
}

export async function updateNetworkUser(id: string, input: { parentUserId?: string | null; canReview?: boolean; canPublishTasks?: boolean; canInviteMembers?: boolean }): Promise<User> {
  const response = await request<ApiResponse<{ user: ApiRow }>>(`/api/network/users/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  return mapUser(response.user);
}
