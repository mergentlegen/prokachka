import type { Announcement, AuthUser, RankEntry, StarAward, Submission, Store, Task, TaskProgram, User } from "@/shared/domain/types";
import { mutationTopics, resourceTopics, userScope } from "@/shared/domain/live-updates";
import { announceMutation, dataCache, localChangeEvent } from "@/frontend/shared/api/data-cache";
import { ScopeChangedError } from "@/frontend/shared/lib/query-cache";
import { starAwardOption } from "@/shared/domain/star-awards";

type ApiRow = Record<string, unknown>;
type ApiResponse<T> = { ok: boolean; message?: string } & T;
const devSessionStorageKey = "incruises_dev_session";
function devSessionToken() { if (typeof window === "undefined") return ""; return window.sessionStorage.getItem(devSessionStorageKey) || ""; }
const apiTimeoutMs = 15000;
function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit) {
  if (typeof window === "undefined") return fetch(input, init);
  const controller = new AbortController(); const timeoutId = window.setTimeout(() => controller.abort(), apiTimeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => window.clearTimeout(timeoutId));
}
export function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const token = devSessionToken();
  return fetchWithTimeout(input, { ...init, cache: init?.cache || "no-store", headers: { ...(token ? { "x-incruises-dev-session": token } : {}), ...(init?.headers || {}) } });
}
export function clearDevSession() { dataCache.activate(""); if (typeof window !== "undefined") { window.sessionStorage.removeItem(devSessionStorageKey); window.localStorage.removeItem(devSessionStorageKey); } }export function saveDevSession(value: unknown) {
  if (typeof window !== "undefined" && typeof value === "string" && value.length > 0) {
    window.sessionStorage.setItem(devSessionStorageKey, value);
  }
}
let sessionRequest: { epoch: number; promise: Promise<AuthUser> } | undefined;
export function refreshAuthSession(): Promise<AuthUser> {
  const epoch = dataCache.epoch;
  if (sessionRequest?.epoch === epoch) return sessionRequest.promise;
  const promise = (async () => {
    const response = await authFetch("/api/auth/session");
    const body = await response.json().catch(() => ({})) as ApiResponse<{ user?: AuthUser; session?: string; devAuthMode?: boolean }>;
    if (epoch !== dataCache.epoch) throw new ScopeChangedError();
    if (!response.ok || !body.user) {
      if (response.status === 401) dataCache.activate("");
      throw new ApiError(typeof body.message === "string" ? body.message : "Сессия не найдена.", response.status);
    }
    dataCache.activate(userScope(body.user));
    if (body.devAuthMode === true) saveDevSession(body.session);
    return body.user;
  })().finally(() => { if (sessionRequest?.promise === promise) sessionRequest = undefined; });
  sessionRequest = { epoch, promise };
  return promise;
}
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export function openLiveStream(signal: AbortSignal) {
  const token = devSessionToken();
  return fetch("/api/events", { signal, cache: "no-store", headers: token ? { "x-incruises-dev-session": token } : {} });
}
export async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const url = String(input);
  const method = (init?.method || "GET").toUpperCase();
  const fetcher = async () => {
    const response = await authFetch(input, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && typeof window !== "undefined") {
        dataCache.activate("");
        window.dispatchEvent(new CustomEvent(localChangeEvent, { detail: ["session"] }));
      }
      throw new ApiError(typeof body.message === "string" ? body.message : "API request failed", response.status);
    }
    return body as T;
  };
  if (typeof window !== "undefined" && method === "GET" && resourceTopics(url).length) return dataCache.read(url, fetcher);
  const body = await fetcher();
  if (method !== "GET") announceMutation(mutationTopics(url, method));
  return body;
}
export function mapTask(row: ApiRow): Task {
  return { id: String(row.id), title: String(row.title || ""), description: String(row.description || ""), maxPoints: Number(row.max_points || 0),
    deadlineAt: row.deadline_at ? String(row.deadline_at) : undefined, isActive: Boolean(row.is_active), teamId: row.team_id ? String(row.team_id) : undefined,
    publicationType: row.publication_type === "sequential" || row.publication_type === "evergreen" ? row.publication_type : "fixed",
    programId: row.program_id ? String(row.program_id) : undefined, position: row.position ? Number(row.position) : undefined,
    deadlineHours: row.deadline_hours ? Number(row.deadline_hours) : undefined, unlockedAt: row.unlocked_at ? String(row.unlocked_at) : undefined,
    resourceUrl: row.resource_url ? String(row.resource_url) : undefined,
    dueAt: row.due_at ? String(row.due_at) : undefined, createdAt: String(row.created_at || new Date().toISOString()),
    publisherId: row.publisher_id ? String(row.publisher_id) : undefined,
    updatedAt: String(row.updated_at || row.created_at || new Date().toISOString()) };
}
export function mapProgram(row: ApiRow): TaskProgram {
  return { id: String(row.id), teamId: String(row.team_id), title: String(row.title || ""), deadlineHours: Number(row.deadline_hours || 72), isActive: Boolean(row.is_active), publisherId: row.publisher_id ? String(row.publisher_id) : undefined, createdAt: String(row.created_at || new Date().toISOString()), updatedAt: String(row.updated_at || row.created_at || new Date().toISOString()) };
}
export function mapAnnouncement(row: ApiRow): Announcement { return { id: String(row.id), teamId: String(row.team_id), authorId: row.author_id ? String(row.author_id) : undefined, title: String(row.title || ""), content: String(row.content || ""), resourceUrl: row.resource_url ? String(row.resource_url) : undefined, isActive: Boolean(row.is_active), createdAt: String(row.created_at || new Date().toISOString()), updatedAt: String(row.updated_at || row.created_at || new Date().toISOString()) }; }
export function mapStarAward(row: ApiRow): StarAward {
  const mentor = Array.isArray(row.mentor) ? row.mentor[0] : row.mentor;
  return {
    id: String(row.id), userId: String(row.user_id), teamId: String(row.team_id),
    mentorId: row.mentor_id ? String(row.mentor_id) : undefined,
    mentorName: mentor && typeof mentor === "object" && "name" in mentor ? String(mentor.name || "") : undefined,
    kind: starAwardOption(row.award_kind)?.kind,
    stars: Number(row.stars || 0), comment: String(row.comment || ""), createdAt: String(row.created_at || new Date().toISOString()),
  };
}
export function mapUser(row: ApiRow): User { return { id: String(row.id), name: String(row.name || ""), login: row.login ? String(row.login) : undefined, telegramId: row.telegram_id ? String(row.telegram_id) : undefined, role: row.role === "ceo" ? "ceo" : row.role === "admin" ? "admin" : "member", teamId: row.team_id ? String(row.team_id) : row.teamId ? String(row.teamId) : undefined, teamJoinedAt: row.team_joined_at ? String(row.team_joined_at) : row.teamJoinedAt ? String(row.teamJoinedAt) : undefined, parentUserId: row.parent_user_id ? String(row.parent_user_id) : row.parentUserId ? String(row.parentUserId) : undefined, canReview: Boolean(row.can_review ?? row.canReview), canPublishTasks: Boolean(row.can_publish_tasks ?? row.canPublishTasks), canInviteMembers: Boolean(row.can_invite_members ?? row.canInviteMembers), createdAt: String(row.created_at || row.createdAt || new Date().toISOString()) }; }
export function mapSubmission(row: ApiRow): Submission { return { id: String(row.id), userId: String(row.user_id), taskId: String(row.task_id), taskTitle: String((Array.isArray(row.tasks) ? row.tasks[0] : row.tasks)?.title || ""), taskMaxPoints: (Array.isArray(row.tasks) ? row.tasks[0] : row.tasks)?.max_points, reviewVersion: Number(row.review_version || 0), status: row.status === "accepted" || row.status === "revision" ? row.status : "pending", mediaType: row.media_type === "text" || row.media_type === "photo" || row.media_type === "video" || row.media_type === "document" ? row.media_type : undefined, answerText: row.answer_text ? String(row.answer_text) : undefined, points: Number(row.points || 0), comment: String(row.comment || ""), submittedAt: String(row.submitted_at || new Date().toISOString()), reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined }; }

export type MemberData = { store: Store; ranking: RankEntry[]; starRanking: RankEntry[]; network: User[] };
export type MemberDataset = "tasks" | "submissions" | "ranking" | "announcements" | "stars" | "network";
export async function loadMemberData(userId: string, keys: readonly MemberDataset[] = ["tasks", "submissions", "ranking", "announcements", "stars", "network"]): Promise<MemberData> {
  const read = <T,>(key: MemberDataset, url: string, empty: T): Promise<T> => keys.includes(key)
    ? request<T>(url) : Promise.resolve(dataCache.peek<T>(url) ?? empty);
  const [tasksResponse, submissionsResponse, rankingResponse, announcementsResponse, starsResponse, networkResponse] = await Promise.all([
    read("tasks", "/api/tasks?view=member", { tasks: [] as ApiRow[] }), read("submissions", "/api/submissions?userId=" + encodeURIComponent(userId), { submissions: [] as ApiRow[] }),
    read("ranking", "/api/ranking", { ranking: [] as RankEntry[], starRanking: [] as RankEntry[] }), read("announcements", "/api/announcements", { announcements: [] as ApiRow[] }), read("stars", "/api/stars", { awards: [] as ApiRow[] }), read("network", "/api/network", { users: [] as ApiRow[] }),
  ]);
  return { store: { tasks: tasksResponse.tasks.map(mapTask), users: [], programs: [], programProgress: [], announcements: announcementsResponse.announcements.map(mapAnnouncement), starAwards: starsResponse.awards.map(mapStarAward), submissions: submissionsResponse.submissions.map(mapSubmission) }, ranking: rankingResponse.ranking, starRanking: rankingResponse.starRanking || [], network: networkResponse.users.map(mapUser) };
}
export async function createMemberSubmission(taskId: string): Promise<string> {
  const response = await request<ApiResponse<{ url: string }>>("/api/submissions", { method: "POST", body: JSON.stringify({ taskId }) });
  return response.url;
}
export async function createTelegramLink(): Promise<{ url?: string; linked: boolean; telegramId?: string }> { const response = await request<ApiResponse<{ url?: string; linked: boolean; telegramId?: string }>>("/api/telegram/link", { method: "POST", body: JSON.stringify({}) }); return { url: response.url, linked: response.linked, telegramId: response.telegramId }; }
export async function loadTelegramLinkStatus(): Promise<{ linked: boolean; telegramId?: string }> { const response = await request<ApiResponse<{ linked: boolean; telegramId?: string }>>("/api/telegram/link/status"); return { linked: response.linked, telegramId: response.telegramId }; }
export function mapAuthUserToUser(user: AuthUser): User { return { ...user, createdAt: new Date().toISOString() }; }
