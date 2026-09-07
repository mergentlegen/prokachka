import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export async function findJoinRequests(options: { userId?: string; teamId?: string } = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("team_join_requests").select("*, users!team_join_requests_user_id_fkey(name,login,team_id), teams(name)").order("created_at", { ascending: false });
  if (options.userId) query = query.eq("user_id", options.userId);
  if (options.teamId) query = query.eq("team_id", options.teamId);
  const result = await query;
  return result.error ? { error: result.error } : { data: result.data };
}

export async function createJoinRequest(userId: string, teamId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const user = await supabase.from("users").select("team_id").eq("id", userId).single();
  if (user.error) return { error: user.error };
  if (user.data.team_id) return { validationError: "У тебя уже есть команда." };
  const team = await supabase.from("teams").select("id").eq("id", teamId).eq("is_active", true).single();
  if (team.error) return { validationError: "Команда недоступна." };
  const result = await supabase.from("team_join_requests").insert({ user_id: userId, team_id: teamId }).select().single();
  return result.error ? { error: result.error } : { data: result.data };
}

export async function reviewJoinRequest(id: string, status: "approved" | "rejected", reviewerId?: string, reviewerTeamId?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const request = await supabase.from("team_join_requests").select("id,user_id,team_id,status").eq("id", id).single();
  if (request.error || !request.data) return { error: request.error || new Error("Request not found") };
  if (reviewerTeamId && request.data.team_id !== reviewerTeamId) return { forbidden: true as const };
  if (request.data.status !== "pending") return { validationError: "Заявка уже обработана." };
  if (status === "approved") {
    const assigned = await supabase.from("users").update({ team_id: request.data.team_id, team_joined_at: new Date().toISOString() }).eq("id", request.data.user_id).is("team_id", null);
    if (assigned.error) return { error: assigned.error };
  }
  const result = await supabase.from("team_join_requests").update({ status, reviewed_at: new Date().toISOString(), reviewed_by: reviewerId && reviewerId !== "ceo" ? reviewerId : null }).eq("id", id).select().single();
  return result.error ? { error: result.error } : { data: result.data };
}