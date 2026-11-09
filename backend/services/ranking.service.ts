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

/** The participant's level (1 when there is no row), and that level again while its congratulation was not shown. */
export async function findMemberLevel(userId: string): Promise<{ level: number; levelUp: number | null }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { level: 1, levelUp: null };
  const result = await supabase.from("member_levels").select("level, celebrated_at").eq("user_id", userId).is("revoked_at", null)
    .order("level", { ascending: false }).limit(1).maybeSingle();
  if (result.error || !result.data) return { level: 1, levelUp: null };
  const level = Number(result.data.level) || 1;
  return { level, levelUp: level > 1 && !result.data.celebrated_at ? level : null };
}

export async function markMemberLevelSeen(userId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_member_level_seen", { p_user: userId });
  return result.error ? { error: result.error } : { data: Boolean(result.data) };
}
export const findStarRanking = (scope: TeamScope) => ranking(scope, "stars");
