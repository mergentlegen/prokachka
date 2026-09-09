import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { descendants, findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";

export type ProgramHistoryStatus = "on_time" | "active" | "late" | "missed" | "completed" | "locked";
export type ProgramHistoryStepMember = {
  userId: string;
  name: string;
  status: Exclude<ProgramHistoryStatus, "completed">;
  dueAt?: string;
  submittedAt?: string;
  points?: number;
};
export type ProgramHistoryMember = {
  userId: string;
  name: string;
  status: ProgramHistoryStatus;
  currentStep?: number;
  currentTaskTitle?: string;
  dueAt?: string;
  submittedAt?: string;
  points?: number;
};
export type ProgramHistoryStep = {
  id: string;
  title: string;
  position: number;
  maxPoints: number;
  deadlineHours: number;
  members: ProgramHistoryStepMember[];
};
export type ProgramHistory = {
  id: string;
  teamId: string;
  title: string;
  deadlineHours: number;
  isActive: boolean;
  createdAt: string;
  steps: ProgramHistoryStep[];
  members: ProgramHistoryMember[];
};

function addHours(value: string, hours: number) {
  return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString();
}
function maxDate(first: string, second: string) {
  return new Date(Math.max(new Date(first).getTime(), new Date(second).getTime())).toISOString();
}
function latestSubmission(rows: Array<Record<string, unknown>>, userId: string, taskId: string) {
  return rows
    .filter((row) => String(row.user_id) === userId && String(row.task_id) === taskId)
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))[0];
}
function latestAcceptedSubmission(rows: Array<Record<string, unknown>>, userId: string, taskId: string) {
  return rows
    .filter((row) => String(row.user_id) === userId && String(row.task_id) === taskId && row.status === "accepted")
    .sort((a, b) => String(b.reviewed_at || b.submitted_at).localeCompare(String(a.reviewed_at || a.submitted_at)))[0];
}

export async function findProgramHistory(teamId: string, viewer?: { id: string; role: string }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const [programsResult, tasksResult, usersResult] = await Promise.all([
    supabase.from("task_programs").select("*").eq("team_id", teamId).order("created_at", { ascending: false }),
    supabase.from("tasks").select("id,title,max_points,program_id,position,deadline_hours").eq("team_id", teamId).eq("publication_type", "sequential").order("position", { ascending: true }),
    supabase.from("users").select("id,name,role,team_id,team_joined_at").eq("team_id", teamId).eq("role", "member").order("created_at", { ascending: true }),
  ]);
  if (programsResult.error || tasksResult.error || usersResult.error) return { error: programsResult.error || tasksResult.error || usersResult.error };

  const programs = programsResult.data || [];
  const tasks = tasksResult.data || [];
  const users = usersResult.data || [];
  const programIds = programs.map((program) => String(program.id));
  const taskIds = tasks.map((task) => String(task.id));
  const [progressResult, submissionsResult] = await Promise.all([
    programIds.length ? supabase.from("member_program_progress").select("*").in("program_id", programIds) : Promise.resolve({ data: [], error: null }),
    taskIds.length ? supabase.from("submissions").select("user_id,task_id,status,points,submitted_at,reviewed_at").in("task_id", taskIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (progressResult.error || submissionsResult.error) return { error: progressResult.error || submissionsResult.error };

  const network = viewer?.role === "member" ? await findTeamNetwork(teamId) : null;
  if (network && "unavailable" in network) return network;
  if (network && "error" in network) return network;
  const visibleUsers = network && "data" in network
    ? new Set(network.data.filter((row) => String(row.role) === "member" && descendants(network.data, viewer?.id || "", true).has(String(row.id))).map((row) => String(row.id)))
    : null;
  const visiblePrograms = visibleUsers && network && "data" in network
    ? programs.filter((program) => isAudienceVisible(network.data, viewer?.id || "", program.audience_root_id))
    : programs;

  const progress = progressResult.data || [];
  const submissions = submissionsResult.data || [];
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

      const programUsers = visibleUsers ? users.filter((user) => visibleUsers.has(String(user.id))) : users;
      const stepMembers = steps.map((step, stepIndex) => programUsers.map((user): ProgramHistoryStepMember => {
        const userId = String(user.id);
        const start = maxDate(String(user.team_joined_at || program.created_at), String(program.created_at));
        const previousTask = programTasks[stepIndex - 1];
        const previousAccepted = previousTask ? latestAcceptedSubmission(submissions, userId, String(previousTask.id)) : undefined;
        const unlockedAt = stepIndex === 0 ? start : previousAccepted ? String(previousAccepted.reviewed_at || previousAccepted.submitted_at) : undefined;
        if (!unlockedAt) return { userId, name: String(user.name || ""), status: "locked" };

        const dueAt = addHours(unlockedAt, Number(step.deadlineHours || deadlineHours));
        const submission = latestSubmission(submissions, userId, String(step.id));
        const submittedAt = submission ? String(submission.submitted_at) : undefined;
        const status: Exclude<ProgramHistoryStatus, "completed"> = submission
          ? new Date(submittedAt as string).getTime() <= new Date(dueAt).getTime() ? "on_time" : "late"
          : new Date(dueAt).getTime() > Date.now() ? "active" : "missed";
        return { userId, name: String(user.name || ""), status, dueAt, submittedAt, points: Number(submission?.points || 0) };
      }));
      steps.forEach((step, index) => { step.members = stepMembers[index]; });

      const members = programUsers.map((user): ProgramHistoryMember => {
        const userId = String(user.id);
        const memberProgress = progress.find((row) => String(row.user_id) === userId && String(row.program_id) === programId);
        if (memberProgress?.status === "completed") return { userId, name: String(user.name || ""), status: "completed" };
        const currentIndex = Math.max(0, programTasks.findIndex((task) => String(task.id) === String(memberProgress?.current_task_id)));
        const currentTask = programTasks[currentIndex];
        if (!currentTask || !steps[currentIndex]) return { userId, name: String(user.name || ""), status: "active" };
        const current = stepMembers[currentIndex].find((member) => member.userId === userId);
        return {
          userId, name: String(user.name || ""), status: current?.status || "active", currentStep: Number(currentTask.position || currentIndex + 1),
          currentTaskTitle: String(currentTask.title || ""), dueAt: current?.dueAt, submittedAt: current?.submittedAt, points: current?.points,
        };
      });
      return {
        id: programId, teamId: String(program.team_id), title: String(program.title || ""), deadlineHours, isActive: Boolean(program.is_active),
        createdAt: String(program.created_at), steps, members,
      };
    }),
  };
}
