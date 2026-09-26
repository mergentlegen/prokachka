import { readPages } from "@/backend/infrastructure/supabase/read-pages";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";

function addHours(value: string, hours: number) { return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString(); }

export async function getMemberTaskFeed(userId: string, teamId: string, joinedAt?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const [tasksResult, programsResult, progressResult] = await Promise.all([
    readPages(supabase.from("tasks").select("*").eq("team_id", teamId).eq("is_active", true).order("created_at", { ascending: false }).order("id")),
    readPages(supabase.from("task_programs").select("*").eq("team_id", teamId).eq("is_active", true).order("created_at", { ascending: false }).order("id")),
    readPages(supabase.from("member_program_progress").select("*").eq("user_id", userId).order("id")),
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
      const refreshed = await readPages(supabase.from("member_program_progress").select("*").eq("user_id", userId).order("id"));
      if (refreshed.error) return { error: refreshed.error };
      refreshed.data?.forEach((row) => existing.set(String(row.program_id), row));
    }
  }
  const programIds = new Set(programs.map((program) => String(program.id)));
  return { data: tasks.filter((task) => {
    if (task.program_id && !programIds.has(String(task.program_id))) return false;
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
