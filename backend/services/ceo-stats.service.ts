import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { readPages } from "@/backend/infrastructure/supabase/read-pages";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const TIME_ZONE = "Asia/Almaty";

export type CeoTeamStats = {
  teamId: string; members: number; mentors: number; active14: number; submissions7: number; newMembers30: number;
  pending: number; oldestPendingAt: string | null; avgReviewHours: number | null; lastSubmissionAt: string | null;
  recentTasks: Array<{ id: string; title: string; createdAt: string }>;
};
export type CeoUserStats = { miles: number; stars: number; works90: number; lastSubmittedAt: string | null; hasTelegram: boolean };
export type CeoStats = {
  generatedAt: string;
  platform: { pending: number; oldestPendingAt: string | null; avgReviewHours: number | null };
  daily: Array<{ date: string; submissions: number; newUsers: number }>;
  teams: CeoTeamStats[];
  users: Record<string, CeoUserStats>;
};

type UserRow = { id: string; team_id: string | null; role: string; created_at: string; team_joined_at: string | null };
type SubmissionRow = { id: string; user_id: string; status: string; submitted_at: string; reviewed_at: string | null };

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const average = (values: number[]) => values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;

// Platform-wide numbers for the CEO dashboard, computed from existing tables (no extra storage).
export async function findCeoStats(now = Date.now()) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const since90 = new Date(now - 90 * DAY).toISOString();
  const [users, recent, pending, points, stars, telegram, tasks] = await Promise.all([
    readPages<UserRow>(supabase.from("users").select("id,team_id,role,created_at,team_joined_at").order("id")),
    readPages<SubmissionRow>(supabase.from("submissions").select("id,user_id,status,submitted_at,reviewed_at").gte("submitted_at", since90).order("id")),
    readPages<SubmissionRow>(supabase.from("submissions").select("id,user_id,status,submitted_at,reviewed_at").eq("status", "pending").order("id")),
    readPages<{ id: string; points: number | string }>(supabase.rpc("app_ranking", { p_team_id: null, p_metric: "points" }).order("id")),
    readPages<{ id: string; points: number | string }>(supabase.rpc("app_ranking", { p_team_id: null, p_metric: "stars" }).order("id")),
    readPages<{ id: string }>(supabase.from("users").select("id").not("telegram_id", "is", null).order("id")),
    readPages<{ id: string; team_id: string; title: string; created_at: string }>(supabase.from("tasks").select("id,team_id,title,created_at").eq("is_active", true).order("id")),
  ]);
  const failed = [users, recent, pending, points, stars, telegram, tasks].find((item) => item.error);
  if (failed) return { error: failed.error };
  return { data: buildCeoStats({ users: users.data || [], recent: recent.data || [], pending: pending.data || [], points: points.data || [], stars: stars.data || [], telegram: telegram.data || [], tasks: tasks.data || [] }, now) };
}

export function buildCeoStats(input: {
  users: UserRow[]; recent: SubmissionRow[]; pending: SubmissionRow[]; points: Array<{ id: string; points: number | string }>;
  stars: Array<{ id: string; points: number | string }>; telegram: Array<{ id: string }>; tasks: Array<{ id: string; team_id: string; title: string; created_at: string }>;
}, now = Date.now()): CeoStats {
  const teamOf = new Map(input.users.map((user) => [user.id, user.team_id]));
  const reviewHours = (rows: SubmissionRow[]) => rows.filter((row) => row.reviewed_at && row.status !== "pending" && Date.parse(row.reviewed_at) >= now - 30 * DAY)
    .map((row) => Math.max(0, (Date.parse(row.reviewed_at!) - Date.parse(row.submitted_at)) / HOUR));
  const oldest = (rows: SubmissionRow[]) => rows.reduce<string | null>((min, row) => !min || row.submitted_at < min ? row.submitted_at : min, null);

  const teamIds = [...new Set(input.users.map((user) => user.team_id).filter((id): id is string => Boolean(id)))];
  const teams = teamIds.map((teamId): CeoTeamStats => {
    const people = input.users.filter((user) => user.team_id === teamId);
    const memberIds = new Set(people.filter((user) => user.role === "member").map((user) => user.id));
    const works = input.recent.filter((row) => teamOf.get(row.user_id) === teamId);
    const waiting = input.pending.filter((row) => teamOf.get(row.user_id) === teamId);
    return {
      teamId, members: memberIds.size, mentors: people.filter((user) => user.role === "admin").length,
      active14: new Set(works.filter((row) => Date.parse(row.submitted_at) >= now - 14 * DAY && memberIds.has(row.user_id)).map((row) => row.user_id)).size,
      submissions7: works.filter((row) => Date.parse(row.submitted_at) >= now - 7 * DAY).length,
      newMembers30: people.filter((user) => user.role === "member" && Date.parse(user.team_joined_at || user.created_at) >= now - 30 * DAY).length,
      pending: waiting.length, oldestPendingAt: oldest(waiting), avgReviewHours: average(reviewHours(works)),
      lastSubmissionAt: works.reduce<string | null>((max, row) => !max || row.submitted_at > max ? row.submitted_at : max, null),
      recentTasks: input.tasks.filter((task) => task.team_id === teamId).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3)
        .map((task) => ({ id: task.id, title: task.title, createdAt: task.created_at })),
    };
  });

  const daily = Array.from({ length: 30 }, (_, index) => ({ date: dayKey.format(new Date(now - (29 - index) * DAY)), submissions: 0, newUsers: 0 }));
  const byDate = new Map(daily.map((day) => [day.date, day]));
  for (const row of input.recent) { const day = byDate.get(dayKey.format(new Date(row.submitted_at))); if (day) day.submissions++; }
  for (const user of input.users) { const day = byDate.get(dayKey.format(new Date(user.created_at))); if (day && user.role !== "ceo") day.newUsers++; }

  const users: Record<string, CeoUserStats> = {};
  const hasTelegram = new Set(input.telegram.map((row) => row.id));
  const miles = new Map(input.points.map((row) => [String(row.id), Number(row.points) || 0]));
  const starCount = new Map(input.stars.map((row) => [String(row.id), Number(row.points) || 0]));
  const worksByUser = new Map<string, { count: number; last: string | null }>();
  for (const row of input.recent) {
    const entry = worksByUser.get(row.user_id) || { count: 0, last: null };
    entry.count++; if (!entry.last || row.submitted_at > entry.last) entry.last = row.submitted_at;
    worksByUser.set(row.user_id, entry);
  }
  for (const user of input.users) {
    const works = worksByUser.get(user.id);
    users[user.id] = { miles: miles.get(user.id) || 0, stars: starCount.get(user.id) || 0, works90: works?.count || 0, lastSubmittedAt: works?.last || null, hasTelegram: hasTelegram.has(user.id) };
  }

  return {
    generatedAt: new Date(now).toISOString(),
    platform: { pending: input.pending.length, oldestPendingAt: oldest(input.pending), avgReviewHours: average(reviewHours(input.recent)) },
    daily, teams, users,
  };
}
