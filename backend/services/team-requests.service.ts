import type { AuthUser } from "@/shared/domain/types";
import { readPages } from "@/backend/infrastructure/supabase/read-pages";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { findInvitationByToken } from "@/backend/services/network.service";
import { withAvatarUrls } from "@/backend/services/avatar-urls.service";

async function requestAvatars<T extends Record<string, unknown>>(rows: T[]) {
  const people = rows.map((row) => (Array.isArray(row.users) ? row.users[0] : row.users) || {});
  const signed = await withAvatarUrls(people);
  return rows.map((row, index) => ({ ...row, users: Array.isArray(row.users) ? [signed[index]] : signed[index] }));
}

export async function findJoinRequests(options: { userId?: string; teamId?: string } = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("team_join_requests").select("*, users!team_join_requests_user_id_fkey(name,team_id,avatar_path), teams(name)").order("created_at", { ascending: false });
  if (options.userId) query = query.eq("user_id", options.userId);
  if (options.teamId) query = query.eq("team_id", options.teamId);
  const result = await readPages(query.order("id"));
  return result.error ? { error: result.error } : { data: await requestAvatars(result.data || []) };
}

export async function createJoinRequest(userId: string, teamId: string, inviteToken?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const user = await supabase.from("users").select("team_id").eq("id", userId).single();
  if (user.error) return { error: user.error };
  if (user.data.team_id) return { validationError: "У тебя уже есть команда." };
  const team = await supabase.from("teams").select("id").eq("id", teamId).eq("is_active", true).single();
  if (team.error) return { validationError: "Команда недоступна." };
  let invitedByUserId: string | undefined;
  let invitationId: string | undefined;
  if (inviteToken) {
    const invitation = await findInvitationByToken(inviteToken);
    if ("unavailable" in invitation) return { unavailable: true as const };
    if ("error" in invitation) return { error: invitation.error };
    if ("validationError" in invitation) return { validationError: invitation.validationError };
    if (String(invitation.data.team_id) !== teamId) return { validationError: "Ссылка приглашения относится к другой команде." };
    invitedByUserId = String(invitation.data.inviter_user_id);
    invitationId = String(invitation.data.id);
  }
  const result = await supabase.from("team_join_requests").insert({ user_id: userId, team_id: teamId, invited_by_user_id: invitedByUserId || null, invitation_id: invitationId || null }).select().single();
  return result.error ? { error: result.error } : { data: result.data };
}

export async function reviewJoinRequest(id: string, status: "approved" | "rejected", actor: AuthUser) {
  if (!actor || (actor.role !== "ceo" && (actor.role !== "admin" || !actor.teamId))) return { forbidden: true as const };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_review_join_request", {
    p_id: id, p_status: status, p_reviewer: actor.id === "ceo" ? null : actor.id, p_ceo: actor.role === "ceo",
  });
  if (result.error) return { error: result.error };
  const outcome = result.data as { processed?: boolean; forbidden?: boolean; validationError?: string };
  if (outcome.forbidden) return { forbidden: true as const };
  if (outcome.validationError) return { validationError: outcome.validationError };
  if (!outcome.processed) return { error: new Error("Request was not processed") };
  const updated = await supabase.from("team_join_requests").select("*, users!team_join_requests_user_id_fkey(name,team_id,avatar_path), teams(name)").eq("id", id).single();
  return updated.error ? { error: updated.error } : { data: (await requestAvatars([updated.data]))[0] };
}
