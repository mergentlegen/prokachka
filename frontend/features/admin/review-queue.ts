import { plural } from "@/frontend/shared/lib/plural";
import type { Submission, User } from "@/shared/domain/types";

export type WaitTone = "fresh" | "waiting" | "late";
const HOUR = 3_600_000, DAY = 24 * HOUR;

// The oldest work first: whoever has waited longest is reviewed first.
export function reviewQueue(submissions: Submission[]) {
  return submissions.filter((item) => item.status === "pending").sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id));
}

export function waitingInfo(submittedAt: string, now = Date.now()): { text: string; tone: WaitTone } {
  const waited = Math.max(0, now - Date.parse(submittedAt));
  const days = Math.floor(waited / DAY), hours = Math.floor(waited / HOUR);
  const text = days >= 1 ? `ждёт ${days} ${plural(days, "день", "дня", "дней")}` : hours >= 1 ? `ждёт ${hours} ч` : "только что";
  return { text, tone: waited >= 2 * DAY ? "late" : waited >= DAY ? "waiting" : "fresh" };
}

// Participants who joined at least two weeks ago and sent nothing in the last 14 days.
export function quietMembers(users: User[], submissions: Submission[], now = Date.now()) {
  const since = now - 14 * DAY;
  const active = new Set(submissions.filter((item) => Date.parse(item.submittedAt) >= since).map((item) => item.userId));
  return users.filter((user) => user.role === "member" && !active.has(user.id) && Date.parse(user.teamJoinedAt || user.createdAt) <= since);
}

export function newMembers(users: User[], now = Date.now()) {
  return users.filter((user) => user.role === "member" && Date.parse(user.teamJoinedAt || user.createdAt) > now - 7 * DAY)
    .sort((a, b) => (b.teamJoinedAt || b.createdAt).localeCompare(a.teamJoinedAt || a.createdAt));
}

// Works sent per calendar day (local time), oldest day first.
export function dailyActivity(submissions: Submission[], days = 14, now = Date.now()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: days }, (_, index) => {
    const day = new Date(today); day.setDate(today.getDate() - (days - 1 - index));
    return { date: day, count: 0 };
  });
  const first = buckets[0].date.getTime();
  for (const item of submissions) {
    const time = Date.parse(item.submittedAt);
    if (!Number.isFinite(time) || time < first) continue;
    const local = new Date(time); local.setHours(0, 0, 0, 0);
    const bucket = buckets.find((entry) => entry.date.getTime() === local.getTime());
    if (bucket) bucket.count++;
  }
  return buckets;
}

export function weeklyLeaders(submissions: Submission[], users: User[], now = Date.now(), limit = 5) {
  const since = now - 7 * DAY;
  const totals = new Map<string, number>();
  for (const item of submissions) {
    if (item.status !== "accepted" || !item.reviewedAt || Date.parse(item.reviewedAt) < since) continue;
    totals.set(item.userId, (totals.get(item.userId) || 0) + item.points);
  }
  const byId = new Map(users.map((user) => [user.id, user]));
  return [...totals].filter(([id, miles]) => byId.has(id) && miles > 0)
    .map(([id, miles]) => ({ user: byId.get(id)!, miles }))
    .sort((a, b) => b.miles - a.miles || a.user.name.localeCompare(b.user.name, "ru")).slice(0, limit);
}

export { plural };
