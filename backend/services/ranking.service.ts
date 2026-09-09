import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

type RankingRow = { id: string; name: string; points: number };
function aggregate(rows: Array<{ value: unknown; user: unknown }>, teamId?: string, userIds?: Set<string>) {
  const result = new Map<string, RankingRow>();
  for (const row of rows) {
    const user = Array.isArray(row.user) ? row.user[0] : row.user;
    if (!user || typeof user !== "object") continue;
    const typed = user as { id: unknown; name: unknown; team_id?: unknown; role?: unknown };
    if (typed.role && typed.role !== "member") continue;
    if (teamId && String(typed.team_id || "") !== teamId) continue;
    const id = String(typed.id);
    if (userIds && !userIds.has(id)) continue;
    const current = result.get(id) || { id, name: String(typed.name || ""), points: 0 };
    current.points += Number(row.value || 0);
    result.set(id, current);
  }
  return [...result.values()].filter((member) => member.points > 0).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}
export async function findRanking(teamId?: string, userIds?: Set<string>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.from("submissions").select("points, users(id,name,team_id,role)").eq("status", "accepted");
  if (result.error) return { error: result.error };
  return { data: aggregate((result.data || []).map((row) => ({ value: row.points, user: row.users })), teamId, userIds) };
}
export async function findStarRanking(teamId?: string, userIds?: Set<string>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  // Do not embed users here: star_awards has two FKs to users (recipient and mentor).
  const awards = await supabase.from("star_awards").select("stars,user_id");
  if (awards.error) return { error: awards.error };
  const ids = [...new Set((awards.data || []).map((row) => String(row.user_id)))];
  if (ids.length === 0) return { data: [] as RankingRow[] };
  const users = await supabase.from("users").select("id,name,team_id,role").in("id", ids);
  if (users.error) return { error: users.error };
  const byId = new Map((users.data || []).map((user) => [String(user.id), user]));
  return {
    data: aggregate((awards.data || []).map((row) => ({ value: row.stars, user: byId.get(String(row.user_id)) })), teamId, userIds),
  };
}
