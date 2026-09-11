import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

type RankingRow = { id: string; name: string; points: number };
type RankingUser = { id: unknown; name: unknown; team_id?: unknown; role?: unknown };
function aggregate(rows: Array<{ value: unknown; user: unknown }>, teamId?: string, userIds?: Set<string>, members: RankingUser[] = []) {
  const result = new Map<string, RankingRow>();
  for (const member of members) {
    if (member.role && member.role !== "member") continue;
    if (teamId && String(member.team_id || "") !== teamId) continue;
    const id = String(member.id);
    if (userIds && !userIds.has(id)) continue;
    result.set(id, { id, name: String(member.name || ""), points: 0 });
  }
  for (const row of rows) {
    const user = Array.isArray(row.user) ? row.user[0] : row.user;
    if (!user || typeof user !== "object") continue;
    const typed = user as RankingUser;
    if (typed.role && typed.role !== "member") continue;
    if (teamId && String(typed.team_id || "") !== teamId) continue;
    const id = String(typed.id);
    if (userIds && !userIds.has(id)) continue;
    const current = result.get(id) || { id, name: String(typed.name || ""), points: 0 };
    current.points += Number(row.value || 0);
    result.set(id, current);
  }
  return [...result.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}
export async function findRanking(teamId?: string, userIds?: Set<string>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const [result, members] = await Promise.all([
    supabase.from("submissions").select("points, users(id,name,team_id,role)").eq("status", "accepted"),
    supabase.from("users").select("id,name,team_id,role").eq("role", "member"),
  ]);
  if (result.error || members.error) return { error: result.error || members.error };
  return { data: aggregate((result.data || []).map((row) => ({ value: row.points, user: row.users })), teamId, userIds, (members.data || []) as RankingUser[]) };
}
export async function findStarRanking(teamId?: string, userIds?: Set<string>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  // Do not embed users here: star_awards has two FKs to users (recipient and mentor).
  let awardsQuery = supabase.from("star_awards").select("stars,user_id");
  if (teamId) awardsQuery = awardsQuery.eq("team_id", teamId);
  const [awards, users] = await Promise.all([
    awardsQuery,
    supabase.from("users").select("id,name,team_id,role").eq("role", "member"),
  ]);
  if (awards.error || users.error) return { error: awards.error || users.error };
  const byId = new Map((users.data || []).map((user) => [String(user.id), user]));
  return {
    data: aggregate((awards.data || []).map((row) => ({ value: row.stars, user: byId.get(String(row.user_id)) })), teamId, userIds, (users.data || []) as RankingUser[]),
  };
}
