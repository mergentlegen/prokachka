import type { RankEntry, Submission, Task } from "@/shared/domain/types";
import { compareTaskFeed } from "@/shared/domain/task-feed-order";

export type TaskState = "todo" | "review" | "done" | "closed";
export type DeadlineTone = "calm" | "soon" | "urgent" | "expired";

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

export function taskDeadline(task: Task) { return task.dueAt || task.deadlineAt || undefined; }

// Mirrors the actions on the task card: what the participant can still do with this task.
export function taskState(task: Task, submission: Submission | undefined, now = Date.now()): TaskState {
  if (submission?.status === "accepted" && submission.interactiveCompleted !== false) return "done";
  if (submission?.status === "pending") return "review";
  const deadline = taskDeadline(task);
  const expired = Boolean(deadline && Date.parse(deadline) <= now);
  if (!task.isActive || (expired && task.publicationType !== "sequential")) return "closed";
  return "todo";
}

export function deadlineInfo(deadline: string | null | undefined, now = Date.now()): { text: string; tone: DeadlineTone } | null {
  if (!deadline) return null;
  const left = Date.parse(deadline) - now;
  if (!Number.isFinite(left)) return null;
  if (left <= 0) return { text: "срок истёк", tone: "expired" };
  const days = Math.floor(left / DAY), hours = Math.floor((left % DAY) / HOUR), minutes = Math.max(1, Math.floor((left % HOUR) / MINUTE));
  const text = days >= 2 ? `осталось ${days} ${plural(days, "день", "дня", "дней")}`
    : days === 1 ? `остался 1 день${hours ? ` ${hours} ч` : ""}`
    : hours ? `осталось ${hours} ч${hours < 6 && minutes ? ` ${minutes} мин` : ""}` : `осталось ${minutes} мин`;
  return { text, tone: left <= 6 * HOUR ? "urgent" : left <= 2 * DAY ? "soon" : "calm" };
}

export function latestSubmissions(submissions: Submission[], userId: string) {
  const latest = new Map<string, Submission>();
  for (const submission of submissions) {
    if (submission.userId !== userId) continue;
    const current = latest.get(submission.taskId);
    if (!current || submission.submittedAt > current.submittedAt) latest.set(submission.taskId, submission);
  }
  return latest;
}

// The most urgent thing to do: overdue program steps, then the nearest deadline, then the usual feed order.
export function focusTasks(tasks: Task[], latest: ReadonlyMap<string, Submission>, now = Date.now()) {
  const urgency = (task: Task) => {
    const deadline = taskDeadline(task);
    if (!deadline) return Infinity;
    const time = Date.parse(deadline);
    return time <= now ? -Infinity : time;
  };
  return tasks.filter((task) => taskState(task, latest.get(task.id), now) === "todo").sort((a, b) => {
    const left = urgency(a), right = urgency(b);
    return (left === right ? 0 : left < right ? -1 : 1) || compareTaskFeed(a, b);
  });
}

export function milesSince(submissions: Submission[], userId: string, since: number) {
  return submissions.reduce((sum, item) => item.userId === userId && item.status === "accepted" && item.reviewedAt && Date.parse(item.reviewedAt) >= since ? sum + item.points : sum, 0);
}

// How much the participant needs to overtake the person directly above them.
export function rankGap(ranking: RankEntry[], userId: string) {
  const index = ranking.findIndex((entry) => entry.id === userId);
  if (index < 0) return null;
  const mine = ranking[index].points;
  const ahead = index > 0 ? ranking[index - 1] : undefined;
  return { place: index + 1, points: mine, ahead, gap: ahead ? Math.max(1, ahead.points - mine + 1) : 0 };
}

export function plural(value: number, one: string, few: string, many: string) {
  const lastTwo = Math.abs(value) % 100, last = Math.abs(value) % 10;
  return lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}
