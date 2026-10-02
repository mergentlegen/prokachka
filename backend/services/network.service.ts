import { createHash, createHmac } from "node:crypto";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import type { AuthUser, NetworkStats } from "@/shared/domain/types";
import { withAvatarUrls } from "@/backend/services/avatar-urls.service";
import { readPages } from "@/backend/infrastructure/supabase/read-pages";

export type NetworkUserRow = {
  id: string;
  name: string;
  avatar_path?: string | null;
  avatar_url?: string;
  login?: string | null;
  role: string;
  team_id?: string | null;
  parent_user_id?: string | null;
  can_review?: boolean;
  can_publish_tasks?: boolean;
  can_invite_members?: boolean;
  team_joined_at?: string | null;
  created_at?: string;
};

const networkSelect = "id,name,avatar_path,login,role,team_id,parent_user_id,can_review,can_publish_tasks,can_invite_members,team_joined_at,created_at";

export async function findTeamNetwork(teamId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const rows: NetworkUserRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await supabase.from("users").select(networkSelect).eq("team_id", teamId)
      .order("id", { ascending: true }).range(offset, offset + 499);
    if (result.error) return { error: result.error };
    rows.push(...(result.data || []) as NetworkUserRow[]);
    if ((result.data || []).length < 500) return { data: rows };
  }
}

function invitationHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function stableInvitationToken(teamId: string, inviterId: string) {
  const secret = process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHmac("sha256", secret).update(`team-invitation:${teamId}:${inviterId}`, "utf8").digest("base64url");
}

export async function findInvitationByToken(token: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.from("team_invitation_links").select("id,team_id,inviter_user_id,expires_at,revoked_at,max_uses,used_count").eq("token_hash", invitationHash(token)).maybeSingle();
  if (result.error) return { error: result.error };
  if (!result.data || result.data.revoked_at || (result.data.expires_at && new Date(String(result.data.expires_at)).getTime() <= Date.now()) || (Number(result.data.max_uses) > 0 && Number(result.data.used_count) >= Number(result.data.max_uses))) {
    return { validationError: "Ссылка приглашения недействительна или уже исчерпала лимит." };
  }
  const [inviter, team] = await Promise.all([
    supabase.from("users").select("id,team_id,role,name").eq("id", result.data.inviter_user_id).maybeSingle(),
    supabase.from("teams").select("id,is_active,name").eq("id", result.data.team_id).maybeSingle(),
  ]);
  if (inviter.error || !inviter.data || inviter.data.team_id !== result.data.team_id || !["admin", "member"].includes(String(inviter.data.role)) || team.error || !team.data?.is_active) return { validationError: "Автор приглашения или команда больше недоступны." };
  // Only names leave this function for a visitor: no ids, limits or dates.
  return { data: result.data, preview: { inviterName: String(inviter.data.name || ""), teamName: String(team.data.name || "") } };
}

export async function createTeamInvitation(teamId: string, inviterId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const token = stableInvitationToken(teamId, inviterId);
  if (!token) return { error: new Error("AUTH_SECRET is required for permanent invitations") };

  const existing = await supabase.from("team_invitation_links").select("id,team_id,inviter_user_id,token_hash,expires_at,max_uses,used_count,created_at").eq("team_id", teamId).eq("inviter_user_id", inviterId).is("revoked_at", null).order("created_at", { ascending: false }).limit(1);
  if (existing.error) return { error: existing.error };
  const current = existing.data?.[0];
  if (current && current.token_hash === invitationHash(token)) {
    const { token_hash: _tokenHash, ...invitation } = current;
    return { data: { ...invitation, token } };
  }

  if (current) {
    const revoked = await supabase.from("team_invitation_links").update({ revoked_at: new Date().toISOString() }).eq("team_id", teamId).eq("inviter_user_id", inviterId).is("revoked_at", null);
    if (revoked.error) return { error: revoked.error };
  }

  const result = await supabase.from("team_invitation_links").insert({ team_id: teamId, inviter_user_id: inviterId, token_hash: invitationHash(token), expires_at: null, max_uses: 0 }).select("id,team_id,inviter_user_id,expires_at,max_uses,used_count,created_at").single();
  return result.error ? { error: result.error } : { data: { ...result.data, token } };
}


export async function getNetworkForViewer(user: AuthUser) {
  if (!user.teamId) return { data: [] as Array<ReturnType<typeof mapNetworkUser> & NetworkStats> };
  const mentorView = user.role === "admin" || Boolean(user.canReview);
  const [result, stats] = await Promise.all([findTeamNetwork(user.teamId), findNetworkStats(user.teamId, mentorView)]);
  if ("unavailable" in result || "error" in result) return result;
  const allowed = user.role === "ceo" || user.role === "admin"
    ? new Set(result.data.map((row) => String(row.id)))
    : descendants(result.data, user.id, true);
  const users = (await withAvatarUrls(result.data.filter((row) => allowed.has(String(row.id))))).map(mapNetworkUser);
  return { data: users.map((row) => ({ ...row, ...stats?.get(row.id) })) };
}

export const NETWORK_ACTIVITY_DAYS = 30;

// Miles and stars are visible to everyone in the branch; activity and Telegram status only to mentors.
// A failed stats query leaves the numbers out instead of showing a misleading zero.
async function findNetworkStats(teamId: string, mentorView: boolean) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const since = new Date(Date.now() - NETWORK_ACTIVITY_DAYS * 86_400_000).toISOString();
  const none = Promise.resolve({ data: [], error: null });
  const [points, stars, activity, telegram] = await Promise.all([
    readPages<{ id: string; points: number | string }>(supabase.rpc("app_ranking", { p_team_id: teamId, p_metric: "points" }).order("id")),
    readPages<{ id: string; points: number | string }>(supabase.rpc("app_ranking", { p_team_id: teamId, p_metric: "stars" }).order("id")),
    mentorView ? readPages<{ id: string; user_id: string; submitted_at: string }>(supabase.from("submissions").select("id,user_id,submitted_at,users!inner(team_id)")
      .eq("users.team_id", teamId).gte("submitted_at", since).order("id")) : none,
    mentorView ? readPages<{ id: string }>(supabase.from("users").select("id").eq("team_id", teamId).not("telegram_id", "is", null).order("id")) : none,
  ]);
  const failed = [points, stars, activity, telegram].find((item) => item.error);
  if (failed) {
    console.warn("Network stats are temporarily unavailable", { error: failed.error?.message });
    return null;
  }
  const stats = new Map<string, NetworkStats>();
  const entry = (id: string) => { const key = String(id); let value = stats.get(key); if (!value) stats.set(key, value = {}); return value; };
  for (const row of points.data || []) entry(row.id).points = Number(row.points) || 0;
  for (const row of stars.data || []) entry(row.id).stars = Number(row.points) || 0;
  if (mentorView) {
    for (const row of points.data || []) Object.assign(entry(row.id), { recentSubmissions: 0, hasTelegram: false });
    for (const row of activity.data || []) {
      const value = entry(row.user_id);
      value.recentSubmissions = (value.recentSubmissions || 0) + 1;
      if (!value.lastSubmittedAt || row.submitted_at > value.lastSubmittedAt) value.lastSubmittedAt = String(row.submitted_at);
    }
    for (const row of telegram.data || []) entry(row.id).hasTelegram = true;
  }
  return stats;
}

export async function updateNetworkUser(actor: AuthUser, targetId: string, input: { parentUserId?: string | null; canReview?: boolean; canPublishTasks?: boolean }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (actor.role !== "admin" || !actor.teamId) return { forbidden: true as const };
  const network = await findTeamNetwork(actor.teamId);
  if ("unavailable" in network || "error" in network) return network;
  const target = network.data.find((row) => String(row.id) === targetId);
  if (!target || target.role !== "member") return { forbidden: true as const };
  if (input.parentUserId !== undefined) {
    if (input.parentUserId === targetId) return { validationError: "Пользователь не может быть закреплён за собой." };
    if (input.parentUserId) {
      const parent = network.data.find((row) => String(row.id) === input.parentUserId);
      if (!parent || parent.team_id !== actor.teamId || descendants(network.data, targetId, true).has(input.parentUserId)) return { validationError: "Нельзя создать цикл или выбрать пользователя из другой команды." };
    }
  }
  const patch: Record<string, unknown> = {};
  if (input.parentUserId !== undefined) patch.parent_user_id = input.parentUserId || null;
  if (input.canReview !== undefined) patch.can_review = input.canReview;
  if (input.canPublishTasks !== undefined) patch.can_publish_tasks = input.canPublishTasks;
  if (!Object.keys(patch).length) return { validationError: "Нет изменений для сохранения." };
  const saved = await supabase.rpc("app_update_network_user", { p_actor: actor.id, p_target: targetId, p_patch: patch });
  if (saved.error) return { error: saved.error };
  const outcome = saved.data as { forbidden?: boolean; data: NetworkUserRow };
  if (outcome.forbidden) return { forbidden: true as const };
  return { data: mapNetworkUser((await withAvatarUrls([outcome.data]))[0]) };
}

export function descendants(rows: NetworkUserRow[], rootId: string, includeRoot = true) {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_user_id) continue;
    const list = children.get(String(row.parent_user_id)) || [];
    list.push(String(row.id));
    children.set(String(row.parent_user_id), list);
  }
  const result = new Set<string>();
  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  if (includeRoot) result.add(rootId);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const child of children.get(current) || []) {
      if (visited.has(child)) continue;
      visited.add(child);
      result.add(child);
      queue.push(child);
    }
  }
  return result;
}

export function ancestors(rows: NetworkUserRow[], userId: string) {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const result = new Set<string>([userId]);
  let current = byId.get(userId);
  let guard = 0;
  while (current?.parent_user_id && guard++ < rows.length) {
    const parentId = String(current.parent_user_id);
    if (result.has(parentId)) break;
    result.add(parentId);
    current = byId.get(parentId);
  }
  return result;
}

export function isAudienceVisible(rows: NetworkUserRow[], viewerId: string, audienceRootId?: unknown) {
  if (!audienceRootId) return true;
  return ancestors(rows, viewerId).has(String(audienceRootId));
}


export function canReviewNetwork(rows: NetworkUserRow[], reviewerId: string, targetUserId: string, role: string) {
  if (reviewerId === targetUserId) return false;
  if (role === "ceo" || role === "admin") return true;
  return descendants(rows, reviewerId, false).has(targetUserId);
}

export function mapNetworkUser(row: NetworkUserRow) {
  return {
    id: String(row.id), name: String(row.name || ""), avatarUrl: row.avatar_url, login: row.login ? String(row.login) : undefined,
    role: row.role === "admin" ? "admin" : "member", teamId: row.team_id ? String(row.team_id) : undefined,
    parentUserId: row.parent_user_id ? String(row.parent_user_id) : undefined,
    canReview: Boolean(row.can_review), canPublishTasks: Boolean(row.can_publish_tasks), canInviteMembers: Boolean(row.can_invite_members),
    teamJoinedAt: row.team_joined_at ? String(row.team_joined_at) : undefined,
    createdAt: String(row.created_at || new Date().toISOString()),
  };
}
