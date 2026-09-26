import { readPages } from "@/backend/infrastructure/supabase/read-pages";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { descendants, findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";
import { readyProgramByKey } from "@/shared/domain/ready-programs";
import type { ReadyProgramKey, TaskInteractiveKind, TaskPublicationType } from "@/shared/domain/types";
import { removeAttachmentPaths } from "@/backend/services/task-attachments.service";

type ProgramTaskInput = { title: string; description: string; maxPoints: number; resourceUrl?: string | null; publicationType?: TaskPublicationType; interactiveKind?: TaskInteractiveKind };
type ProgramViewer = { id: string; role: string; teamId?: string; canPublishTasks?: boolean };
export type ProgramInput = { teamId: string; title: string; deadlineHours: number; tasks: ProgramTaskInput[]; publisherId?: string; audienceRootId?: string | null; templateKey?: ReadyProgramKey };

export async function findPrograms(teamId?: string, viewer?: ProgramViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("task_programs").select("*").order("is_pinned", { ascending: false }).order("created_at", { ascending: true });
  if (teamId) query = query.eq("team_id", teamId);
  const result = await readPages(query.order("id"));
  if (result.error) return { error: result.error };
  if (!teamId || !viewer || viewer.role === "ceo" || viewer.role === "admin") return { data: result.data };
  const network = await findTeamNetwork(teamId);
  if ("unavailable" in network) return { unavailable: true as const };
  if ("error" in network) return { error: network.error };
  const allowedAuthors = descendants(network.data, viewer.id, true);
  return { data: (result.data || []).filter((program) => isAudienceVisible(network.data, viewer.id, program.audience_root_id) || (program.publisher_id && allowedAuthors.has(String(program.publisher_id)))) };
}
export async function createProgram(input: ProgramInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_create_program", { p_input: input });
  return result.error ? { error: result.error } : { data: result.data as { program: Record<string, unknown>; tasks: Record<string, unknown>[] } };
}

export async function findReadyProgramPublications(teamId: string, audienceRootId: string | null = null) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const query = supabase.from("task_programs").select("id,template_key,is_active,publisher_id,audience_root_id,is_pinned,created_at").eq("team_id", teamId).not("template_key", "is", null);
  const result = await readPages((audienceRootId ? query.eq("audience_root_id", audienceRootId) : query.is("audience_root_id", null)).order("id"));
  return result.error ? { error: result.error } : { data: result.data || [] };
}

export async function publishReadyProgram(input: { teamId: string; key: ReadyProgramKey; publisherId?: string; audienceRootId?: string | null }) {
  const template = readyProgramByKey(input.key);
  if (!template) return { validationError: "Готовая программа не найдена." };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  // A publication belongs to an audience, not just a template/team. A sibling's
  // publication must never be reported as a successful publication for this branch.
  const lookup = () => {
    const query = supabase.from("task_programs").select("*").eq("team_id", input.teamId).eq("template_key", template.key);
    return input.audienceRootId ? query.eq("audience_root_id", input.audienceRootId) : query.is("audience_root_id", null);
  };
  const reuse = async (publication: Record<string, unknown>) => {
    const activated = await supabase.rpc("app_update_program", { p_id: publication.id, p_patch: { isActive: true }, p_actor: input.publisherId || null, p_ceo: !input.publisherId });
    if (activated.error) return { error: activated.error };
    if (activated.data?.forbidden || !activated.data?.data) return { validationError: "У вас нет доступа к публикации в этой области." };
    const program = activated.data.data as Record<string, unknown>;
    const tasks = await supabase.from("tasks").select("*").eq("program_id", program.id).order("position", { ascending: true }).order("id");
    if (tasks.error) return { error: tasks.error };
    if (!tasks.data?.length) return { validationError: "Публикация игры повреждена: нет задания. Обратитесь к администратору." };
    return { alreadyPublished: true as const, data: { program, tasks: tasks.data } };
  };
  const existing = await lookup().maybeSingle();
  if (existing.error) return { error: existing.error };
  if (existing.data) {
    return reuse(existing.data);
  }
  const result = await createProgram({
    teamId: input.teamId,
    title: template.title,
    deadlineHours: 720,
    templateKey: template.key,
    publisherId: input.publisherId,
    audienceRootId: input.audienceRootId,
    tasks: template.tasks.map((task) => ({ ...task })),
  });
  if ("error" in result && result.error?.code === "23505") {
    const retry = await lookup().maybeSingle();
    if (!retry.error && retry.data) {
      return reuse(retry.data);
    }
    if (retry.error) return { error: retry.error };
    return { validationError: "Примените миграцию областей публикации готовых заданий: 20260928-publication-audiences.sql." };
  }
  return result;
}
export async function updateProgram(id: string, input: { title?: string; deadlineHours?: number; isActive?: boolean; isPinned?: boolean }, actor?: ProgramViewer) {
  if (!actor || (actor.role !== "ceo" && !actor.teamId)) return { forbidden: true as const };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_update_program", {
    p_id: id, p_patch: input, p_actor: actor.id === "ceo" ? null : actor.id, p_ceo: actor.role === "ceo",
  });
  if (result.error) return { error: result.error };
  const outcome = result.data as { data?: Record<string, unknown>; forbidden?: boolean };
  return outcome.forbidden ? { forbidden: true as const } : { data: outcome.data };
}

export async function deleteProgram(id: string, actor?: ProgramViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const current = await supabase.from("task_programs").select("id,team_id,publisher_id,template_key").eq("id", id).maybeSingle();
  if (current.error || !current.data) return { forbidden: true as const };
  const canDelete = actor?.role === "ceo" || (Boolean(actor?.teamId) && current.data.team_id === actor?.teamId && (actor?.role === "admin" || (actor?.canPublishTasks === true && current.data.publisher_id === actor.id)));
  if (!canDelete) return { forbidden: true as const };
  if (current.data.template_key) return { validationError: "Используйте «Убрать из заданий» в каталоге: результаты готовой игры не удаляются." };
  const taskRows = await supabase.from("tasks").select("id").eq("program_id", id);
  if (taskRows.error) return { error: taskRows.error };
  const attachments = taskRows.data?.length ? await supabase.from("task_attachments").select("storage_path").in("task_id", taskRows.data.map((row) => String(row.id))) : { data: [], error: null };
  if (attachments.error) return { error: attachments.error };
  let query = supabase.from("task_programs").delete().eq("id", id);
  if (actor?.role !== "ceo" && actor?.teamId) query = query.eq("team_id", actor.teamId);
  const result = await query.select("id");
  if (result.error) return { error: result.error };
  const cleanup = await removeAttachmentPaths((attachments.data || []).map((row) => String(row.storage_path)));
  return { data: true, storageCleanupWarning: cleanup.warning };
}
