import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export async function findUsers(teamId?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("users").select("id,name,login,role,team_id,team_joined_at,created_at").order("created_at", { ascending: false });
  if (teamId) query = query.eq("team_id", teamId);
  const result = await query;
  return result.error ? { error: result.error } : { data: result.data };
}

export async function saveUser(name: string, telegramId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.from("users").upsert({ name, telegram_id: telegramId, role: "member" }, { onConflict: "telegram_id" }).select("id,name,login,role,team_id,team_joined_at,created_at").single();
  return result.error ? { error: result.error } : { data: result.data };
}
export async function updateUserAccess(id: string, input: { role?: "admin" | "member"; teamId?: string | null }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const patch: Record<string, unknown> = {};
  if (input.role === "admin" || input.role === "member") patch.role = input.role;
  if (input.teamId !== undefined) {
    const current = await supabase.from("users").select("team_id,team_joined_at").eq("id", id).single();
    if (current.error || !current.data) return { error: current.error || new Error("User not found") };
    patch.team_id = input.teamId || null;
    patch.team_joined_at = input.teamId ? (current.data.team_id === input.teamId ? current.data.team_joined_at : new Date().toISOString()) : null;
  }
  const result = await supabase.from("users").update(patch).eq("id", id).select("id,name,login,role,team_id,team_joined_at,created_at").single();
  return result.error ? { error: result.error } : { data: result.data };
}