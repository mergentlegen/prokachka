import { readPages } from "@/backend/infrastructure/supabase/read-pages";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { descendants, findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";
import { removeAttachmentPaths } from "@/backend/services/task-attachments.service";

type TaskViewer = { id: string; role: string; teamId?: string; canPublishTasks?: boolean };

type TaskInput = {
  title?: string; description?: string; maxPoints?: number; deadlineAt?: string | null; isActive?: boolean; isPinned?: boolean; teamId?: string;
  publicationType?: "evergreen" | "fixed" | "sequential"; programId?: string; position?: number; deadlineHours?: number; resourceUrl?: string | null;
  publisherId?: string; audienceRootId?: string | null;
};

export async function findTasks(teamId?: string, viewer?: TaskViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("tasks").select("*").order("is_pinned", { ascending: false }).order("pinned_at", { ascending: true }).order("created_at", { ascending: true });
  if (teamId) query = query.eq("team_id", teamId);
  const result = await readPages(query.order("id"));
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
  if (input.programId) {
    const program = await supabase.from("task_programs").select("team_id,publisher_id,audience_root_id,template_key").eq("id", input.programId).maybeSingle();
    if (program.data?.template_key) return { validationError: "Шаги готовой игры нельзя изменять. Управляйте публикацией в каталоге." };
    if (program.error || !program.data || program.data.team_id !== input.teamId || (program.data.publisher_id || null) !== (input.publisherId || null) || String(program.data.audience_root_id || "") !== String(input.audienceRootId || "")) {
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
  const current = await supabase.from("tasks").select("id,team_id,publisher_id,program_id,interactive_kind").eq("id", id).maybeSingle();
  if (current.error || !current.data) return { forbidden: true as const };
  const canEdit = actor?.role === "ceo" || (Boolean(actor?.teamId) && current.data.team_id === actor?.teamId && (actor?.role === "admin" || (actor?.canPublishTasks === true && current.data.publisher_id === actor.id)));
  if (!canEdit) return { forbidden: true as const };
  if (current.data.interactive_kind) return { validationError: "Готовую игру нельзя изменять как обычное задание. Используйте каталог готовых заданий." };
  if (input.isPinned !== undefined && current.data.program_id) return { validationError: "Закрепляйте программу целиком." };
  const patch: Record<string, unknown> = {};
  if (typeof input.title === "string") patch.title = input.title.trim();
  if (typeof input.description === "string") patch.description = input.description.trim();
  if (input.maxPoints !== undefined) patch.max_points = Math.min(100, Math.max(0, Number(input.maxPoints) || 0));
  if (input.deadlineAt !== undefined) patch.deadline_at = input.deadlineAt || null;
  if (input.isActive !== undefined) patch.is_active = Boolean(input.isActive);
  if (input.isPinned !== undefined) patch.is_pinned = input.isPinned;
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
  const current = await supabase.from("tasks").select("id,team_id,publisher_id,interactive_kind").eq("id", id).maybeSingle();
  if (current.error || !current.data) return { forbidden: true as const };
  const canDelete = actor?.role === "ceo" || (Boolean(actor?.teamId) && current.data.team_id === actor?.teamId && (actor?.role === "admin" || (actor?.canPublishTasks === true && current.data.publisher_id === actor.id)));
  if (!canDelete) return { forbidden: true as const };
  if (current.data.interactive_kind) return { validationError: "Используйте «Убрать из заданий» в каталоге: это сохраняет игру, результаты и мили." };
  const attachments = await supabase.from("task_attachments").select("storage_path").eq("task_id", id);
  if (attachments.error) return { error: attachments.error };
  let query = supabase.from("tasks").delete().eq("id", id);
  if (actor?.role !== "ceo" && actor?.teamId) query = query.eq("team_id", actor.teamId);
  const result = await query.select("id");
  if (result.error) return { error: result.error };
  const cleanup = await removeAttachmentPaths((attachments.data || []).map((row) => String(row.storage_path)));
  return { data: true, storageCleanupWarning: cleanup.warning };
}
