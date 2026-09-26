import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { readPages } from "@/backend/infrastructure/supabase/read-pages";
import { descendants, findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";
import { withAvatarUrls } from "@/backend/services/avatar-urls.service";

import type { ProgramHistory, ProgramHistoryStatus, ProgramHistoryStep, ProgramHistoryStepMember, ProgramHistoryMember } from "@/shared/domain/history";

function addHours(value: string, hours: number) {
  return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString();
}
function maxDate(first: string, second: string) {
  return new Date(Math.max(new Date(first).getTime(), new Date(second).getTime())).toISOString();
}
function indexSubmissions(rows: Array<Record<string, unknown>>, acceptedOnly = false) {
  const result = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (acceptedOnly && row.status !== "accepted") continue;
    const key = String(row.user_id) + ":" + String(row.task_id);
    const previous = result.get(key);
    const date = String(acceptedOnly ? row.reviewed_at || row.submitted_at : row.submitted_at);
    const previousDate = previous ? String(acceptedOnly ? previous.reviewed_at || previous.submitted_at : previous.submitted_at) : "";
    if (!previous || date > previousDate || (date === previousDate && String(row.id) > String(previous.id))) result.set(key, row);
  }
  return result;
}

export async function findProgramHistory(teamId: string, viewer?: { id: string; role: string }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const [programsResult, tasksResult, usersResult] = await Promise.all([
    readPages(supabase.from("task_programs").select("*").eq("team_id", teamId).order("created_at", { ascending: false }).order("id")),
    readPages(supabase.from("tasks").select("id,title,max_points,program_id,position,deadline_hours").eq("team_id", teamId).eq("publication_type", "sequential").order("position", { ascending: true }).order("id")),
    readPages(supabase.from("users").select("id,name,avatar_path,role,team_id,team_joined_at").eq("team_id", teamId).eq("role", "member").order("created_at", { ascending: true }).order("id")),
  ]);
  if (programsResult.error || tasksResult.error || usersResult.error) return { error: programsResult.error || tasksResult.error || usersResult.error };

  const programs = programsResult.data || [];
  const tasks = tasksResult.data || [];
  const [progressResult, submissionsResult] = await Promise.all([
    readPages(supabase.from("member_program_progress").select("*,task_programs!inner(team_id)").eq("task_programs.team_id", teamId).order("id")),
    readPages(supabase.from("submissions").select("id,user_id,task_id,status,points,submitted_at,reviewed_at,tasks!inner(team_id,publication_type)").eq("tasks.team_id", teamId).eq("tasks.publication_type", "sequential").order("id")),
  ]);
  if (progressResult.error || submissionsResult.error) return { error: progressResult.error || submissionsResult.error };

  const network = await findTeamNetwork(teamId);
  if (network && "unavailable" in network) return network;
  if (network && "error" in network) return network;
  const visibleAuthors = viewer?.role === "member" && "data" in network ? descendants(network.data, viewer?.id || "", true) : null;
  const visibleUsers = visibleAuthors && "data" in network
    ? new Set(network.data.filter((row) => String(row.role) === "member" && visibleAuthors!.has(String(row.id))).map((row) => String(row.id)))
    : null;
  const visiblePrograms = visibleUsers && network && "data" in network
    ? programs.filter((program) => program.publisher_id ? visibleAuthors?.has(String(program.publisher_id)) : isAudienceVisible(network.data, viewer?.id || "", program.audience_root_id))
    : programs;
  const authorNames = network && "data" in network ? new Map(network.data.map((row) => [String(row.id), String(row.name || "")])) : new Map<string, string>();
  const users = await withAvatarUrls((usersResult.data || []).filter((row) => !visibleUsers || visibleUsers.has(String(row.id))));

  const progress = progressResult.data || [];
  const submissions = submissionsResult.data || [];
  const latest = indexSubmissions(submissions);
  const accepted = indexSubmissions(submissions, true);
  const progressByMember = new Map(progress.map((row) => [String(row.user_id) + ":" + String(row.program_id), row]));
  return {
    data: visiblePrograms.map((program): ProgramHistory => {
      const programId = String(program.id);
      const programTasks = tasks.filter((task) => String(task.program_id) === programId).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
      const deadlineHours = Number(program.deadline_hours || 72);
      const steps: ProgramHistoryStep[] = programTasks.map((task, stepIndex) => ({
        id: String(task.id),
        title: String(task.title || ""),
        position: Number(task.position || stepIndex + 1),
        maxPoints: Number(task.max_points || 0),
        deadlineHours: Number(task.deadline_hours || deadlineHours),
        members: [],
      }));

      const programUsers = users.filter((user) => (!visibleUsers || visibleUsers.has(String(user.id)))
        && isAudienceVisible(network.data, String(user.id), program.audience_root_id));
      const stepMembers = steps.map((step, stepIndex) => programUsers.map((user): ProgramHistoryStepMember => {
        const userId = String(user.id);
        const start = maxDate(String(user.team_joined_at || program.created_at), String(program.created_at));
        const previousTask = programTasks[stepIndex - 1];
        const previousAccepted = previousTask ? accepted.get(userId + ":" + String(previousTask.id)) : undefined;
        const unlockedAt = stepIndex === 0 ? start : previousAccepted ? String(previousAccepted.reviewed_at || previousAccepted.submitted_at) : undefined;
        if (!unlockedAt) return { userId, name: String(user.name || ""), avatarUrl: user.avatar_url, status: "locked" };

        const dueAt = addHours(unlockedAt, Number(step.deadlineHours || deadlineHours));
        const submission = latest.get(userId + ":" + String(step.id));
        const submittedAt = submission ? String(submission.submitted_at) : undefined;
        const status: Exclude<ProgramHistoryStatus, "completed"> = submission
          ? new Date(submittedAt as string).getTime() <= new Date(dueAt).getTime() ? "on_time" : "late"
          : new Date(dueAt).getTime() > Date.now() ? "active" : "missed";
        return { userId, name: String(user.name || ""), avatarUrl: user.avatar_url, status, dueAt, submittedAt, points: Number(submission?.points || 0) };
      }));
      steps.forEach((step, index) => { step.members = stepMembers[index]; });

      const members = programUsers.map((user, userIndex): ProgramHistoryMember => {
        const userId = String(user.id);
        const memberProgress = progressByMember.get(userId + ":" + programId);
        if (memberProgress?.status === "completed") return { userId, name: String(user.name || ""), avatarUrl: user.avatar_url, status: "completed" };
        const currentIndex = Math.max(0, programTasks.findIndex((task) => String(task.id) === String(memberProgress?.current_task_id)));
        const currentTask = programTasks[currentIndex];
        if (!currentTask || !steps[currentIndex]) return { userId, name: String(user.name || ""), avatarUrl: user.avatar_url, status: "active" };
        const current = stepMembers[currentIndex][userIndex];
        return {
          userId, name: String(user.name || ""), avatarUrl: user.avatar_url, status: current?.status || "active", currentStep: Number(currentTask.position || currentIndex + 1),
          currentTaskTitle: String(currentTask.title || ""), dueAt: current?.dueAt, submittedAt: current?.submittedAt, points: current?.points,
        };
      });
      return {
        id: programId, teamId: String(program.team_id), title: String(program.title || ""), deadlineHours, isActive: Boolean(program.is_active),
        publisherId: program.publisher_id ? String(program.publisher_id) : undefined,
        publisherName: program.publisher_id ? authorNames.get(String(program.publisher_id)) : undefined,
        createdAt: String(program.created_at), steps, members,
      };
    }),
  };
}
