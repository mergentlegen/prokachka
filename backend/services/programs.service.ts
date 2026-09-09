import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";

type ProgramTaskInput = { title: string; description: string; maxPoints: number; resourceUrl?: string | null };
type ProgramViewer = { id: string; role: string; teamId?: string; canPublishTasks?: boolean };
export type ProgramInput = { teamId: string; title: string; deadlineHours: number; tasks: ProgramTaskInput[]; publisherId?: string; audienceRootId?: string | null };

export async function findPrograms(teamId?: string, viewer?: ProgramViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("task_programs").select("*").order("created_at", { ascending: false });
  if (teamId) query = query.eq("team_id", teamId);
  const result = await query;
  if (result.error) return { error: result.error };
  if (!teamId || !viewer || viewer.role === "ceo" || viewer.role === "admin") return { data: result.data };
  const network = await findTeamNetwork(teamId);
  if ("unavailable" in network) return { unavailable: true as const };
  if ("error" in network) return { error: network.error };
  return { data: (result.data || []).filter((program) => isAudienceVisible(network.data, viewer.id, program.audience_root_id)) };
}
export async function createProgram(input: ProgramInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const program = await supabase.from("task_programs").insert({ team_id: input.teamId, title: input.title.trim(), deadline_hours: input.deadlineHours, publisher_id: input.publisherId || null, audience_root_id: input.audienceRootId || null, is_active: true }).select().single();
  if (program.error || !program.data) return { error: program.error || new Error("Program was not created") };
  const tasks = await supabase.from("tasks").insert(input.tasks.map((task, index) => ({
    team_id: input.teamId, program_id: program.data.id, publication_type: "sequential", position: index + 1,
    title: task.title.trim(), description: task.description.trim(), max_points: task.maxPoints, deadline_at: null,
    resource_url: task.resourceUrl || null,
    publisher_id: input.publisherId || null, audience_root_id: input.audienceRootId || null,
    deadline_hours: input.deadlineHours, is_active: true,
  }))).select();
  if (tasks.error) { await supabase.from("task_programs").delete().eq("id", program.data.id); return { error: tasks.error }; }
  return { data: { program: program.data, tasks: tasks.data || [] } };
}
export async function updateProgram(id: string, input: { title?: string; deadlineHours?: number; isActive?: boolean }, actor?: ProgramViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const current = await supabase.from("task_programs").select("id,team_id,publisher_id").eq("id", id).maybeSingle();
  if (current.error || !current.data) return { forbidden: true as const };
  const canEdit = actor?.role === "ceo" || (Boolean(actor?.teamId) && current.data.team_id === actor?.teamId && (actor?.role === "admin" || (actor?.canPublishTasks === true && current.data.publisher_id === actor.id)));
  if (!canEdit) return { forbidden: true as const };
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.deadlineHours !== undefined) patch.deadline_hours = input.deadlineHours;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  let query = supabase.from("task_programs").update(patch).eq("id", id);
  if (actor?.role !== "ceo" && actor?.teamId) query = query.eq("team_id", actor.teamId);
  const result = await query.select().single();
  if (result.error) return { error: result.error };
  if (input.deadlineHours !== undefined) {
    const tasks = await supabase.from("tasks").update({ deadline_hours: input.deadlineHours }).eq("program_id", id).eq("team_id", result.data.team_id);
    if (tasks.error) return { error: tasks.error };
  }
  return { data: result.data };
}

export async function deleteProgram(id: string, actor?: ProgramViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const current = await supabase.from("task_programs").select("id,team_id,publisher_id").eq("id", id).maybeSingle();
  if (current.error || !current.data) return { forbidden: true as const };
  const canDelete = actor?.role === "ceo" || (Boolean(actor?.teamId) && current.data.team_id === actor?.teamId && (actor?.role === "admin" || (actor?.canPublishTasks === true && current.data.publisher_id === actor.id)));
  if (!canDelete) return { forbidden: true as const };
  let query = supabase.from("task_programs").delete().eq("id", id);
  if (actor?.role !== "ceo" && actor?.teamId) query = query.eq("team_id", actor.teamId);
  const result = await query;
  return result.error ? { error: result.error } : { data: true };
}
