import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

type ProgramTaskInput = { title: string; description: string; maxPoints: number };
export type ProgramInput = { teamId: string; title: string; deadlineHours: number; tasks: ProgramTaskInput[] };

export async function findPrograms(teamId?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("task_programs").select("*").order("created_at", { ascending: false });
  if (teamId) query = query.eq("team_id", teamId);
  const result = await query;
  return result.error ? { error: result.error } : { data: result.data };
}
export async function createProgram(input: ProgramInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const program = await supabase.from("task_programs").insert({ team_id: input.teamId, title: input.title.trim(), deadline_hours: input.deadlineHours, is_active: true }).select().single();
  if (program.error || !program.data) return { error: program.error || new Error("Program was not created") };
  const tasks = await supabase.from("tasks").insert(input.tasks.map((task, index) => ({
    team_id: input.teamId, program_id: program.data.id, publication_type: "sequential", position: index + 1,
    title: task.title.trim(), description: task.description.trim(), max_points: task.maxPoints, deadline_at: null,
    deadline_hours: input.deadlineHours, is_active: true,
  }))).select();
  if (tasks.error) { await supabase.from("task_programs").delete().eq("id", program.data.id); return { error: tasks.error }; }
  return { data: { program: program.data, tasks: tasks.data || [] } };
}
export async function updateProgram(id: string, input: { title?: string; deadlineHours?: number; isActive?: boolean }, teamId?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.deadlineHours !== undefined) patch.deadline_hours = input.deadlineHours;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  let query = supabase.from("task_programs").update(patch).eq("id", id);
  if (teamId) query = query.eq("team_id", teamId);
  const result = await query.select().single();
  if (result.error) return { error: result.error };
  if (input.deadlineHours !== undefined) {
    const tasks = await supabase.from("tasks").update({ deadline_hours: input.deadlineHours }).eq("program_id", id).eq("team_id", result.data.team_id);
    if (tasks.error) return { error: tasks.error };
  }
  return { data: result.data };
}

export async function deleteProgram(id: string, teamId?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("task_programs").delete().eq("id", id);
  if (teamId) query = query.eq("team_id", teamId);
  const result = await query;
  return result.error ? { error: result.error } : { data: true };
}
