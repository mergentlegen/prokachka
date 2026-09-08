import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

type TeamInput = { name?: string; description?: string; isActive?: boolean };

export async function findTeams(includeInactive = false) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("teams").select("*").order("created_at", { ascending: false });
  if (!includeInactive) query = query.eq("is_active", true);
  const result = await query;
  return result.error ? { error: result.error } : { data: result.data };
}

export async function createTeam(input: Required<Pick<TeamInput, "name">> & TeamInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.from("teams").insert({ name: input.name.trim(), description: input.description?.trim() || "", is_active: input.isActive !== false }).select().single();
  return result.error ? { error: result.error } : { data: result.data };
}

export async function updateTeam(id: string, input: TeamInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const patch: Record<string, unknown> = {};
  if (typeof input.name === "string") patch.name = input.name.trim();
  if (typeof input.description === "string") patch.description = input.description.trim();
  if (input.isActive !== undefined) patch.is_active = Boolean(input.isActive);
  const result = await supabase.from("teams").update(patch).eq("id", id).select().single();
  return result.error ? { error: result.error } : { data: result.data };
}

export async function removeTeam(id: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.from("teams").update({ is_active: false }).eq("id", id);
  return result.error ? { error: result.error } : { data: true };
}

export async function deleteTeam(id: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.from("teams").delete().eq("id", id);
  return result.error ? { error: result.error } : { data: true };
}
