import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { readPages } from "@/backend/infrastructure/supabase/read-pages";
import { isValidScope, type TeamScope } from "@/backend/http/access-scope";

async function ranking(scope: TeamScope, metric: "points" | "stars") {
  if (!isValidScope(scope)) return { error: new Error("An explicit ranking scope is required") };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  // SQL aggregates all answers/awards; pagination applies to users, not source rows.
  const result = await readPages<{ id: string; name: string; points: number | string }>(supabase.rpc("app_ranking", {
    p_team_id: scope.kind === "team" ? scope.teamId : null, p_metric: metric,
  }).order("points", { ascending: false }).order("name").order("id"));
  if (result.error) return { error: result.error };
  return { data: (result.data || []).map((row) => ({ id: String(row.id), name: String(row.name), points: Number(row.points) })) };
}

export const findRanking = (scope: TeamScope) => ranking(scope, "points");
export const findStarRanking = (scope: TeamScope) => ranking(scope, "stars");
