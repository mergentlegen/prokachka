import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

type TaskInput = {
  title?: string; description?: string; maxPoints?: number; deadlineAt?: string | null; isActive?: boolean; teamId?: string;
  publicationType?: "evergreen" | "fixed" | "sequential"; programId?: string; position?: number; deadlineHours?: number;
};

export async function findTasks(teamId?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("tasks").select("*").order("created_at", { ascending: false });
  if (teamId) query = query.eq("team_id", teamId);
  const result = await query;
  return result.error ? { error: result.error } : { data: result.data };
}

export async function insertTask(input: Required<Pick<TaskInput, "title" | "description">> & TaskInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!input.teamId) return { validationError: "Задание должно быть привязано к команде." };
  const result = await supabase.from("tasks").insert({
    title: input.title, description: input.description, team_id: input.teamId,
    max_points: Math.min(100, Math.max(0, Number(input.maxPoints) || 0)),
    deadline_at: input.publicationType === "sequential" ? null : input.deadlineAt || null,
    is_active: input.isActive !== false,
    publication_type: input.publicationType || (input.deadlineAt ? "fixed" : "evergreen"),
    program_id: input.programId || null, position: input.position || null, deadline_hours: input.deadlineHours || null,
  }).select().single();
  return result.error ? { error: result.error } : { data: result.data };
}

export async function patchTask(id: string, input: TaskInput, teamId?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const patch: Record<string, unknown> = {};
  if (typeof input.title === "string") patch.title = input.title.trim();
  if (typeof input.description === "string") patch.description = input.description.trim();
  if (input.maxPoints !== undefined) patch.max_points = Math.min(100, Math.max(0, Number(input.maxPoints) || 0));
  if (input.deadlineAt !== undefined) patch.deadline_at = input.deadlineAt || null;
  if (input.isActive !== undefined) patch.is_active = Boolean(input.isActive);
  if (input.deadlineHours !== undefined) patch.deadline_hours = input.deadlineHours;
  let query = supabase.from("tasks").update(patch).eq("id", id);
  if (teamId) query = query.eq("team_id", teamId);
  const result = await query.select().single();
  return result.error ? { error: result.error } : { data: result.data };
}

export async function deleteTask(id: string, teamId?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("tasks").delete().eq("id", id);
  if (teamId) query = query.eq("team_id", teamId);
  const result = await query;
  return result.error ? { error: result.error } : { data: true };
}
