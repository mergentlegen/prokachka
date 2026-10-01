import type { Store, Submission, Task, User } from "@/shared/domain/types";

export type ParticipantStatus = "accepted" | "revision" | "pending" | "overdue" | "not_started";
export type ParticipantResult = { user: User; status: ParticipantStatus; submission?: Submission };

// The latest answer of every participant for a task; nobody is left out of the report.
export function taskParticipantResults(task: Task, store: Pick<Store, "users" | "submissions">, now = Date.now()): ParticipantResult[] {
  const latestByUser = new Map<string, Submission>();
  store.submissions.filter((submission) => submission.taskId === task.id).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)).forEach((submission) => latestByUser.set(submission.userId, submission));
  const expired = Boolean(task.deadlineAt && new Date(task.deadlineAt).getTime() <= now);
  return store.users.filter((user) => user.role === "member").map((user) => {
    const submission = latestByUser.get(user.id);
    return { user, submission, status: submission?.status || (expired ? "overdue" : "not_started") };
  });
}

export function participantStatusText(status: ParticipantStatus) {
  if (status === "accepted") return "Выполнено";
  if (status === "revision") return "На доработке";
  if (status === "pending") return "На проверке";
  if (status === "overdue") return "Просрочил";
  return "Не отправил";
}

// "Sent" means the participant answered at all (accepted, waiting or returned for changes).
export function taskProgress(results: ParticipantResult[]) {
  const count = (status: ParticipantStatus) => results.filter((result) => result.status === status).length;
  const accepted = count("accepted"), pending = count("pending"), revision = count("revision");
  return { total: results.length, sent: accepted + pending + revision, accepted, pending, revision, missing: count("not_started") + count("overdue") };
}
