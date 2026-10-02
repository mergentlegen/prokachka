import type { Team, TeamJoinRequest, User } from "@/shared/domain/types";
import type { CeoStats } from "@/frontend/shared/api/ceo-client";

const HOUR = 3_600_000, DAY = 24 * HOUR;
export type TeamStats = CeoStats["teams"][number];
export type Health = "growing" | "steady" | "quiet" | "empty";

// A team is "quiet" when people are there but nobody sent work for a week.
export function teamHealth(stats: TeamStats | undefined): Health {
  if (!stats || stats.members === 0) return "empty";
  if (stats.submissions7 === 0) return "quiet";
  return stats.active14 / stats.members >= 0.5 ? "growing" : "steady";
}

export function formatHours(hours: number | null) {
  if (hours === null) return "—";
  if (hours < 1) return "меньше часа";
  if (hours < 48) return `${Math.round(hours)} ч`;
  return `${Math.round(hours / 24)} дн.`;
}

export function attentionItems({ teams, users, requests, stats, now = Date.now() }: { teams: Team[]; users: User[]; requests: TeamJoinRequest[]; stats: CeoStats | null; now?: number }) {
  const active = teams.filter((team) => team.isActive);
  const byTeam = new Map((stats?.teams || []).map((item) => [item.teamId, item]));
  return {
    noMentor: active.filter((team) => !users.some((user) => user.teamId === team.id && user.role === "admin")),
    quiet: stats ? active.filter((team) => teamHealth(byTeam.get(team.id)) === "quiet") : [],
    withoutTeam: users.filter((user) => user.role !== "ceo" && !user.teamId),
    oldRequests: requests.filter((request) => request.status === "pending" && now - Date.parse(request.createdAt) > DAY),
    slowReview: stats ? active.filter((team) => { const oldest = byTeam.get(team.id)?.oldestPendingAt; return Boolean(oldest && now - Date.parse(oldest) > 2 * DAY); }) : [],
  };
}

export function daysFromStats(stats: CeoStats | null, key: "submissions" | "newUsers") {
  return (stats?.daily || []).map((day) => ({ date: new Date(`${day.date}T12:00:00`), count: day[key] }));
}
