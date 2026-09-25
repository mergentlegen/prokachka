import { readPages } from "@/backend/infrastructure/supabase/read-pages";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { descendants, findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";
import { readyProgramByKey } from "@/shared/domain/ready-programs";
import type { ReadyProgramKey, TaskInteractiveKind, TaskPublicationType } from "@/shared/domain/types";

type ProgramTaskInput = { title: string; description: string; maxPoints: number; resourceUrl?: string | null; publicationType?: TaskPublicationType; interactiveKind?: TaskInteractiveKind };
type ProgramViewer = { id: string; role: string; teamId?: string; canPublishTasks?: boolean };
export type ProgramInput = { teamId: string; title: string; deadlineHours: number; tasks: ProgramTaskInput[]; publisherId?: string; audienceRootId?: string | null; templateKey?: ReadyProgramKey };

export async function findPrograms(teamId?: string, viewer?: ProgramViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("task_programs").select("*").order("created_at", { ascending: false });
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

export async function findReadyProgramPublications(teamId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.from("task_programs").select("id,template_key,is_active").eq("team_id", teamId).not("template_key", "is", null);
  return result.error ? { error: result.error } : { data: result.data || [] };
}

export async function publishReadyProgram(input: { teamId: string; key: ReadyProgramKey; publisherId?: string; audienceRootId?: string | null }) {
  const template = readyProgramByKey(input.key);
  if (!template) return { validationError: "Готовая программа не найдена." };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const existing = await supabase.from("task_programs").select("*").eq("team_id", input.teamId).eq("template_key", template.key).maybeSingle();
  if (existing.error) return { error: existing.error };
  if (existing.data) {
    const tasks = await supabase.from("tasks").select("*").eq("program_id", existing.data.id).order("position", { ascending: true }).order("id");
    if (tasks.error) return { error: tasks.error };
    return { alreadyPublished: true as const, data: { program: existing.data, tasks: tasks.data || [] } };
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
    const retry = await supabase.from("task_programs").select("*").eq("team_id", input.teamId).eq("template_key", template.key).maybeSingle();
    if (!retry.error && retry.data) {
      const tasks = await supabase.from("tasks").select("*").eq("program_id", retry.data.id).order("position", { ascending: true }).order("id");
      if (tasks.error) return { error: tasks.error };
      return { alreadyPublished: true as const, data: { program: retry.data, tasks: tasks.data || [] } };
    }
  }
  return result;
}
export async function updateProgram(id: string, input: { title?: string; deadlineHours?: number; isActive?: boolean }, actor?: ProgramViewer) {
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
  const current = await supabase.from("task_programs").select("id,team_id,publisher_id").eq("id", id).maybeSingle();
  if (current.error || !current.data) return { forbidden: true as const };
  const canDelete = actor?.role === "ceo" || (Boolean(actor?.teamId) && current.data.team_id === actor?.teamId && (actor?.role === "admin" || (actor?.canPublishTasks === true && current.data.publisher_id === actor.id)));
  if (!canDelete) return { forbidden: true as const };
  let query = supabase.from("task_programs").delete().eq("id", id);
  if (actor?.role !== "ceo" && actor?.teamId) query = query.eq("team_id", actor.teamId);
  const result = await query;
  return result.error ? { error: result.error } : { data: true };
}
