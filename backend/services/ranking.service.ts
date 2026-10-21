import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { readPages } from "@/backend/infrastructure/supabase/read-pages";
import { isValidScope, type TeamScope } from "@/backend/http/access-scope";
import { withAvatarUrls } from "@/backend/services/avatar-urls.service";

async function ranking(scope: TeamScope, metric: "points" | "stars") {
  if (!isValidScope(scope)) return { error: new Error("An explicit ranking scope is required") };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  // SQL aggregates all answers/awards; pagination applies to users, not source rows.
  const result = await readPages<{ id: string; name: string; points: number | string; avatar_path?: string }>(supabase.rpc("app_ranking", {
    p_team_id: scope.kind === "team" ? scope.teamId : null, p_metric: metric,
  }).order("points", { ascending: false }).order("name").order("id"));
  if (result.error) return { error: result.error };
  return { data: (await withAvatarUrls(result.data || [])).map((row) => ({ id: String(row.id), name: String(row.name), avatarUrl: row.avatar_url, points: Number(row.points) })) };
}

export const findRanking = (scope: TeamScope) => ranking(scope, "points");

/** Everyone of the team with their current level and that level's miles and stars. */
export async function findCourseStandings(scope: TeamScope) {
  if (!isValidScope(scope) || scope.kind !== "team") return { error: new Error("A team ranking scope is required") };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await readPages<{ id: string; name: string; avatar_path?: string; level: number | string; level_at?: string; miles: number | string; stars: number | string }>(
    supabase.rpc("app_course_standings", { p_team_id: scope.teamId }).order("id"));
  if (result.error) return { error: result.error };
  return { data: (await withAvatarUrls(result.data || [])).map((row) => ({
    id: String(row.id), name: String(row.name), avatarUrl: row.avatar_url, level: Number(row.level) || 1,
    levelAt: row.level_at ? String(row.level_at) : undefined, miles: Number(row.miles) || 0, stars: Number(row.stars) || 0,
  })) };
}

/** A level reached whose congratulation the participant has not seen yet. */
export async function findPendingLevelUp(userId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const result = await supabase.from("member_levels").select("level").eq("user_id", userId).is("revoked_at", null).is("celebrated_at", null)
    .order("level", { ascending: false }).limit(1).maybeSingle();
  return result.error || !result.data ? null : Number(result.data.level);
}

export async function markMemberLevelSeen(userId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_member_level_seen", { p_user: userId });
  return result.error ? { error: result.error } : { data: Boolean(result.data) };
}
export const findStarRanking = (scope: TeamScope) => ranking(scope, "stars");
