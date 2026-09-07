import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

const starSelect = "id,user_id,team_id,mentor_id,stars,comment,created_at";

export async function findStarAwards(options: { teamId?: string; userId?: string } = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  let query = supabase.from("star_awards").select(starSelect).order("created_at", { ascending: false });
  if (options.teamId) query = query.eq("team_id", options.teamId);
  if (options.userId) query = query.eq("user_id", options.userId);

  const result = await query;
  return result.error ? { error: result.error } : { data: result.data };
}

export async function insertStarAward(input: {
  userId: string;
  teamId: string;
  mentorId: string;
  stars: number;
  comment: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const result = await supabase
    .from("star_awards")
    .insert({
      user_id: input.userId,
      team_id: input.teamId,
      mentor_id: input.mentorId,
      stars: input.stars,
      comment: input.comment,
    })
    .select(starSelect)
    .single();

  return result.error ? { error: result.error } : { data: result.data };
}

export async function removeStarAward(id: string, teamId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const result = await supabase.from("star_awards").delete().eq("id", id).eq("team_id", teamId);
  return result.error ? { error: result.error } : { data: true };
}
