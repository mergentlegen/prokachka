import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export const REVIEW_TEMPLATE_LIMIT = 12;
export const REVIEW_TEMPLATE_MAX_LENGTH = 300;

export async function findReviewTemplates(teamId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.from("review_comment_templates").select("body,position").eq("team_id", teamId).order("position");
  if (result.error) return { error: result.error };
  return { data: (result.data || []).map((row) => String(row.body)) };
}

export async function replaceReviewTemplates(actorId: string, bodies: string[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const saved = await supabase.rpc("app_replace_review_templates", { p_actor: actorId, p_bodies: bodies });
  if (saved.error) return { error: saved.error };
  const outcome = saved.data as { forbidden?: boolean; validationError?: string; data?: string[] };
  if (outcome.forbidden) return { forbidden: true as const };
  if (outcome.validationError) return { validationError: outcome.validationError };
  return { data: outcome.data || [] };
}
