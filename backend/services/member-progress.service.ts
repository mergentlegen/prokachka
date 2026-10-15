import { readPages } from "@/backend/infrastructure/supabase/read-pages";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { ancestors, findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";

function addHours(value: string, hours: number) { return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString(); }

type Row = Record<string, unknown>;

// Every program of the participant with all its visible steps, so the page can show what is done and what is ahead.
// Steps not reached yet travel without their text: it opens together with the step.
export function programModules(programs: Row[], tasks: Row[], progressByProgram: ReadonlyMap<string, Row>) {
  return programs.filter((program) => !program.template_key).flatMap((program) => {
    const steps = tasks.filter((task) => task.publication_type === "sequential" && String(task.program_id) === String(program.id))
      .sort((a, b) => Number(a.position) - Number(b.position) || String(a.id).localeCompare(String(b.id)));
    if (!steps.length) return [];
    const progress = progressByProgram.get(String(program.id));
    const completed = progress?.status === "completed";
    const current = completed ? steps.length : steps.findIndex((task) => String(task.id) === String(progress?.current_task_id));
    return [{
      id: String(program.id), title: String(program.title || ""), is_pinned: Boolean(program.is_pinned), status: completed ? "completed" : "active",
      current_task_id: !completed && current >= 0 ? String(steps[current].id) : null, completed_at: completed ? progress?.completed_at ?? null : null,
      steps: steps.map((task, index) => ({
        id: String(task.id), number: index + 1, title: String(task.title || ""), max_points: Number(task.max_points || 0), interactive_kind: task.interactive_kind ?? null,
        ...(index < current ? { description: String(task.description || ""), resource_url: task.resource_url ?? null } : {}),
      })),
    }];
  });
}

export async function getMemberTaskFeed(userId: string, teamId: string, joinedAt?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  // The team structure is needed for every feed, so it travels together with the lists.
  const [tasksResult, programsResult, progressResult, network] = await Promise.all([
    readPages(supabase.from("tasks").select("*").eq("team_id", teamId).eq("is_active", true).order("created_at", { ascending: true }).order("id")),
    readPages(supabase.from("task_programs").select("*").eq("team_id", teamId).eq("is_active", true).order("created_at", { ascending: true }).order("id")),
    readPages(supabase.from("member_program_progress").select("*").eq("user_id", userId).order("id")),
    findTeamNetwork(teamId),
  ]);
  if (tasksResult.error || programsResult.error || progressResult.error) return { error: tasksResult.error || programsResult.error || progressResult.error };
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
  const programsById = new Map(programs.map((program) => [String(program.id), program]));
  const programSteps = new Map<string, number>();
  for (const task of tasks) if (task.publication_type === "sequential" && task.program_id) programSteps.set(String(task.program_id), (programSteps.get(String(task.program_id)) || 0) + 1);
  const programIds = new Set(programsById.keys());
  const eligible = tasks.filter((task) => {
    if (task.program_id && !programIds.has(String(task.program_id))) return false;
    if (task.publication_type === "evergreen") return true;
    if (task.publication_type === "fixed") return !task.deadline_at || !joinedAt || new Date(task.deadline_at).getTime() >= new Date(joinedAt).getTime();
    if (!programIds.has(String(task.program_id))) return false;
    const progress = existing.get(String(task.program_id));
    return progress?.status === "active" && progress.current_task_id === task.id;
  });
  // The same built-in game may be published by the root and by branch mentors.
  // Show one card, keeping the participant's saved attempt whenever possible.
  const games = new Map<string, typeof eligible>();
  for (const task of eligible) {
    // Only stand-alone ready games are merged; a game step belongs to its own program.
    if (!task.interactive_kind || task.publication_type === "sequential") continue;
    const group = games.get(String(task.interactive_kind)) || [];
    group.push(task); games.set(String(task.interactive_kind), group);
  }
  const duplicates = [...games.values()].filter((group) => group.length > 1);
  const excluded = new Set<string>();
  if (duplicates.length) {
    const attempts = await readPages(supabase.from("ready_program_attempts").select("task_id,status,started_at").eq("user_id", userId).order("id"));
    if (attempts.error) return { error: attempts.error };
    const saved = new Map((attempts.data || []).map((attempt) => [String(attempt.task_id), attempt]));
    const chain = [...ancestors(network.data, userId)];
    const rank = (task: typeof eligible[number]) => {
      const attempt = saved.get(String(task.id));
      const root = programsById.get(String(task.program_id))?.audience_root_id;
      return [attempt?.status === "completed" ? 0 : attempt ? 1 : 2, root ? chain.indexOf(String(root)) : chain.length];
    };
    for (const group of duplicates) {
      group.sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || String(a.id).localeCompare(String(b.id)); });
      group.slice(1).forEach((task) => excluded.add(String(task.id)));
    }
  }
  const modules = programModules(programs, tasks, existing);
  // Passed program steps stay open for reading: their text, video, files and the test with its answers.
  const passedIds = new Set(modules.flatMap((module) => module.steps.filter((step) => "description" in step).map((step) => step.id)));
  const passed = tasks.filter((task) => passedIds.has(String(task.id))).map((task) => ({ ...task, program_title: programsById.get(String(task.program_id))?.title }));
  return { programs: modules, passed, data: eligible.filter((task) => !excluded.has(String(task.id))).map((task) => {
    const program = programsById.get(String(task.program_id));
    const publication = { ...task, is_pinned: program ? Boolean(program.is_pinned) : Boolean(task.is_pinned), pinned_at: program ? program.pinned_at : task.pinned_at };
    if (task.publication_type !== "sequential") return publication;
    const progress = existing.get(String(task.program_id));
    // A game step has no deadline.
    return { ...publication, unlocked_at: progress?.unlocked_at, due_at: task.interactive_kind ? undefined : progress?.due_at, program_title: program?.title, program_steps: programSteps.get(String(task.program_id)) };
  }) };
}

/** A participant may open a task's materials when it is in their feed now or is a program step they have passed. */
export function feedShowsTask(feed: Awaited<ReturnType<typeof getMemberTaskFeed>>, taskId: string) {
  if (!("data" in feed) || !feed.data) return false;
  return feed.data.some((task) => String(task.id) === taskId) || Boolean("passed" in feed && feed.passed?.some((task) => String(task.id) === taskId));
}
