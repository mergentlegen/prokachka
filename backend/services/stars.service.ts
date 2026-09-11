import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { canReviewNetwork, descendants, findTeamNetwork } from "@/backend/services/network.service";

const starSelect = "id,user_id,team_id,mentor_id,stars,comment,created_at";

export async function findStarAwards(options: { teamId?: string; userId?: string; viewer?: { id: string; role: string; canReview?: boolean } } = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  let query = supabase.from("star_awards").select(starSelect).order("created_at", { ascending: false });
  if (options.teamId) query = query.eq("team_id", options.teamId);
  if (options.userId) query = query.eq("user_id", options.userId);

  const result = await query;
  if (result.error) return { error: result.error };
  if (options.viewer?.role !== "member" || !options.teamId) return { data: result.data };
  const network = await findTeamNetwork(options.teamId);
  if ("unavailable" in network) return { unavailable: true as const };
  if ("error" in network) return { error: network.error };
  const allowed = descendants(network.data, options.viewer.id, true);
  return { data: (result.data || []).filter((award) => allowed.has(String(award.user_id))) };
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
  if (input.userId === input.mentorId) return { forbidden: true as const };

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

export async function removeStarAward(id: string, actor: { id: string; role: string; teamId?: string; canReview?: boolean }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const current = await supabase.from("star_awards").select("id,user_id,team_id,mentor_id").eq("id", id).maybeSingle();
  if (current.error || !current.data) return { forbidden: true as const };
  if (actor.role === "ceo") return supabase.from("star_awards").delete().eq("id", id).then((result) => result.error ? { error: result.error } : { data: true });
  if (!actor.teamId || current.data.team_id !== actor.teamId) return { forbidden: true as const };
  if (actor.role === "member") {
    if (!actor.canReview || current.data.mentor_id !== actor.id) return { forbidden: true as const };
    const network = await findTeamNetwork(actor.teamId);
    if ("unavailable" in network) return { unavailable: true as const };
    if ("error" in network) return { error: network.error };
    if (!canReviewNetwork(network.data, actor.id, String(current.data.user_id), actor.role)) return { forbidden: true as const };
  }
  const result = await supabase.from("star_awards").delete().eq("id", id).eq("team_id", actor.teamId);
  return result.error ? { error: result.error } : { data: true };
}
