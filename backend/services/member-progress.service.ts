import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";

function addHours(value: string, hours: number) { return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString(); }

export async function getMemberTaskFeed(userId: string, teamId: string, joinedAt?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const [tasksResult, programsResult, progressResult] = await Promise.all([
    supabase.from("tasks").select("*").eq("team_id", teamId).eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("task_programs").select("*").eq("team_id", teamId).eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("member_program_progress").select("*").eq("user_id", userId),
  ]);
  if (tasksResult.error || programsResult.error || progressResult.error) return { error: tasksResult.error || programsResult.error || progressResult.error };
  const network = await findTeamNetwork(teamId);
  if ("unavailable" in network) return network;
  if ("error" in network) return network;
  const tasks = (tasksResult.data || []).filter((task) => isAudienceVisible(network.data, userId, task.audience_root_id));
  const programs = (programsResult.data || []).filter((program) => isAudienceVisible(network.data, userId, program.audience_root_id));
  const existing = new Map((progressResult.data || []).map((row) => [String(row.program_id), row]));
  const missing = programs.filter((program) => !existing.has(String(program.id)));
  if (missing.length) {
    const firstTasks = tasks.filter((task) => task.publication_type === "sequential" && task.position === 1);
    const rows = missing.map((program) => {
      const first = firstTasks.find((task) => task.program_id === program.id);
      const startMs = Math.max(new Date(joinedAt || program.created_at).getTime(), new Date(program.created_at).getTime());
      const start = new Date(startMs).toISOString();
      return first ? { user_id: userId, program_id: program.id, current_task_id: first.id, unlocked_at: start, due_at: addHours(start, Number(program.deadline_hours || 72)), status: "active" } : null;
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (rows.length) {
      const inserted = await supabase.from("member_program_progress").upsert(rows, { onConflict: "user_id,program_id", ignoreDuplicates: true }).select();
      if (inserted.error && inserted.error.code !== "23505") return { error: inserted.error };
      const refreshed = await supabase.from("member_program_progress").select("*").eq("user_id", userId);
      if (!refreshed.error) refreshed.data?.forEach((row) => existing.set(String(row.program_id), row));
    }
  }
  const programIds = new Set(programs.map((program) => String(program.id)));
  return { data: tasks.filter((task) => {
    if (task.publication_type === "evergreen") return true;
    if (task.publication_type === "fixed") return !task.deadline_at || !joinedAt || new Date(task.deadline_at).getTime() >= new Date(joinedAt).getTime();
    if (!programIds.has(String(task.program_id))) return false;
    const progress = existing.get(String(task.program_id));
    return progress?.status === "active" && progress.current_task_id === task.id;
  }).map((task) => {
    if (task.publication_type !== "sequential") return task;
    const progress = existing.get(String(task.program_id));
    return { ...task, unlocked_at: progress?.unlocked_at, due_at: progress?.due_at };
  }) };
}

export async function advanceProgramAfterAcceptance(userId: string, taskId: string, reviewedAt: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const taskResult = await supabase.from("tasks").select("id,program_id,position,deadline_hours").eq("id", taskId).single();
  if (taskResult.error || !taskResult.data?.program_id) return { data: null };
  const task = taskResult.data;
  const progressResult = await supabase.from("member_program_progress").select("id").eq("user_id", userId).eq("current_task_id", taskId).eq("status", "active").maybeSingle();
  if (progressResult.error) return { error: progressResult.error };
  if (!progressResult.data) return { data: true };
  const next = await supabase.from("tasks").select("id").eq("program_id", task.program_id).eq("position", Number(task.position) + 1).eq("is_active", true).maybeSingle();
  if (next.error) return { error: next.error };
  const update = next.data?.id
    ? { current_task_id: next.data.id, unlocked_at: reviewedAt, due_at: addHours(reviewedAt, Number(task.deadline_hours || 72)), updated_at: reviewedAt }
    : { current_task_id: null, status: "completed", completed_at: reviewedAt, updated_at: reviewedAt };
  const saved = await supabase.from("member_program_progress").update(update).eq("id", progressResult.data.id);
  return saved.error ? { error: saved.error } : { data: true };
}

export async function revertProgramAfterRevision(userId: string, taskId: string, reviewedAt: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const task = await supabase.from("tasks").select("id,program_id,deadline_hours").eq("id", taskId).single();
  if (task.error || !task.data?.program_id) return { data: null };
  const progress = await supabase.from("member_program_progress").select("id").eq("user_id", userId).eq("program_id", task.data.program_id).maybeSingle();
  if (progress.error) return { error: progress.error };
  const payload = { current_task_id: taskId, unlocked_at: reviewedAt, due_at: addHours(reviewedAt, Number(task.data.deadline_hours || 72)), status: "active", completed_at: null, updated_at: reviewedAt };
  const result = progress.data
    ? await supabase.from("member_program_progress").update(payload).eq("id", progress.data.id)
    : await supabase.from("member_program_progress").insert({ user_id: userId, program_id: task.data.program_id, ...payload });
  return result.error ? { error: result.error } : { data: true };
}
