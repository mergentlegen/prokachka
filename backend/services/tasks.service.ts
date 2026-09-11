import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { descendants, findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";

type TaskViewer = { id: string; role: string; teamId?: string; canPublishTasks?: boolean };

type TaskInput = {
  title?: string; description?: string; maxPoints?: number; deadlineAt?: string | null; isActive?: boolean; teamId?: string;
  publicationType?: "evergreen" | "fixed" | "sequential"; programId?: string; position?: number; deadlineHours?: number; resourceUrl?: string | null;
  publisherId?: string; audienceRootId?: string | null;
};

export async function findTasks(teamId?: string, viewer?: TaskViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("tasks").select("*").order("created_at", { ascending: false });
  if (teamId) query = query.eq("team_id", teamId);
  const result = await query;
  if (result.error) return { error: result.error };
  if (!teamId || !viewer || viewer.role === "ceo" || viewer.role === "admin") return { data: result.data };
  const network = await findTeamNetwork(teamId);
  if ("unavailable" in network) return { unavailable: true as const };
  if ("error" in network) return { error: network.error };
  const allowedAuthors = descendants(network.data, viewer.id, true);
  return { data: (result.data || []).filter((task) => isAudienceVisible(network.data, viewer.id, task.audience_root_id) || (task.publisher_id && allowedAuthors.has(String(task.publisher_id)))) };
}

export async function insertTask(input: Required<Pick<TaskInput, "title" | "description">> & TaskInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  if (!input.teamId) return { validationError: "Задание должно быть привязано к команде." };
  if (input.programId && input.publisherId) {
    const program = await supabase.from("task_programs").select("team_id,publisher_id,audience_root_id").eq("id", input.programId).maybeSingle();
    if (program.error || !program.data || program.data.team_id !== input.teamId || program.data.publisher_id !== input.publisherId || String(program.data.audience_root_id || "") !== String(input.audienceRootId || "")) {
      return { forbidden: true as const };
    }
  }
  const result = await supabase.from("tasks").insert({
    title: input.title, description: input.description, team_id: input.teamId,
    max_points: Math.min(100, Math.max(0, Number(input.maxPoints) || 0)),
    deadline_at: input.publicationType === "sequential" ? null : input.deadlineAt || null,
    resource_url: input.resourceUrl || null,
    publisher_id: input.publisherId || null, audience_root_id: input.audienceRootId || null,
    is_active: input.isActive !== false,
    publication_type: input.publicationType || (input.deadlineAt ? "fixed" : "evergreen"),
    program_id: input.programId || null, position: input.position || null, deadline_hours: input.deadlineHours || null,
  }).select().single();
  return result.error ? { error: result.error } : { data: result.data };
}

export async function patchTask(id: string, input: TaskInput, actor?: TaskViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const current = await supabase.from("tasks").select("id,team_id,publisher_id").eq("id", id).maybeSingle();
  if (current.error || !current.data) return { forbidden: true as const };
  const canEdit = actor?.role === "ceo" || (Boolean(actor?.teamId) && current.data.team_id === actor?.teamId && (actor?.role === "admin" || (actor?.canPublishTasks === true && current.data.publisher_id === actor.id)));
  if (!canEdit) return { forbidden: true as const };
  const patch: Record<string, unknown> = {};
  if (typeof input.title === "string") patch.title = input.title.trim();
  if (typeof input.description === "string") patch.description = input.description.trim();
  if (input.maxPoints !== undefined) patch.max_points = Math.min(100, Math.max(0, Number(input.maxPoints) || 0));
  if (input.deadlineAt !== undefined) patch.deadline_at = input.deadlineAt || null;
  if (input.isActive !== undefined) patch.is_active = Boolean(input.isActive);
  if (input.deadlineHours !== undefined) patch.deadline_hours = input.deadlineHours;
  if (input.resourceUrl !== undefined) patch.resource_url = input.resourceUrl || null;
  let query = supabase.from("tasks").update(patch).eq("id", id);
  if (actor?.role !== "ceo" && actor?.teamId) query = query.eq("team_id", actor.teamId);
  const result = await query.select().single();
  return result.error ? { error: result.error } : { data: result.data };
}

export async function deleteTask(id: string, actor?: TaskViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const current = await supabase.from("tasks").select("id,team_id,publisher_id").eq("id", id).maybeSingle();
  if (current.error || !current.data) return { forbidden: true as const };
  const canDelete = actor?.role === "ceo" || (Boolean(actor?.teamId) && current.data.team_id === actor?.teamId && (actor?.role === "admin" || (actor?.canPublishTasks === true && current.data.publisher_id === actor.id)));
  if (!canDelete) return { forbidden: true as const };
  let query = supabase.from("tasks").delete().eq("id", id);
  if (actor?.role !== "ceo" && actor?.teamId) query = query.eq("team_id", actor.teamId);
  const result = await query;
  return result.error ? { error: result.error } : { data: true };
}
