import type { Announcement, AuthUser, MemberProgramProgress, RankEntry, StarAward, Submission, Store, Task, TaskProgram, User } from "@/shared/domain/types";

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
export function clearDevSession() { if (typeof window !== "undefined") { window.sessionStorage.removeItem(devSessionStorageKey); window.localStorage.removeItem(devSessionStorageKey); } }export function saveDevSession(value: unknown) {
  if (typeof window !== "undefined" && typeof value === "string" && value.length > 0) {
    window.sessionStorage.setItem(devSessionStorageKey, value);
  }
}
export async function refreshAuthSession(): Promise<AuthUser> {
  const response = await authFetch("/api/auth/session");
  const body = await response.json().catch(() => ({})) as ApiResponse<{ user?: AuthUser; session?: string; devAuthMode?: boolean }>;
  if (!response.ok || !body.user) throw new Error(typeof body.message === "string" ? body.message : "Сессия не найдена.");
  if (body.devAuthMode === true) saveDevSession(body.session);
  return body.user;
}
export async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const token = devSessionToken();
  const response = await fetchWithTimeout(input, { ...init, cache: init?.cache || "no-store", headers: { "Content-Type": "application/json", ...(token ? { "x-incruises-dev-session": token } : {}), ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "API request failed");
  return body as T;
}
export function mapTask(row: ApiRow): Task {
  return { id: String(row.id), title: String(row.title || ""), description: String(row.description || ""), maxPoints: Number(row.max_points || 0),
    deadlineAt: row.deadline_at ? String(row.deadline_at) : undefined, isActive: Boolean(row.is_active), teamId: row.team_id ? String(row.team_id) : undefined,
    publicationType: row.publication_type === "sequential" || row.publication_type === "evergreen" ? row.publication_type : "fixed",
    programId: row.program_id ? String(row.program_id) : undefined, position: row.position ? Number(row.position) : undefined,
    deadlineHours: row.deadline_hours ? Number(row.deadline_hours) : undefined, unlockedAt: row.unlocked_at ? String(row.unlocked_at) : undefined,
    dueAt: row.due_at ? String(row.due_at) : undefined, createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || row.created_at || new Date().toISOString()) };
}
export function mapProgram(row: ApiRow): TaskProgram {
  return { id: String(row.id), teamId: String(row.team_id), title: String(row.title || ""), deadlineHours: Number(row.deadline_hours || 72), isActive: Boolean(row.is_active), createdAt: String(row.created_at || new Date().toISOString()), updatedAt: String(row.updated_at || row.created_at || new Date().toISOString()) };
}
export function mapProgress(row: ApiRow): MemberProgramProgress {
  return { id: String(row.id), userId: String(row.user_id), programId: String(row.program_id), currentTaskId: row.current_task_id ? String(row.current_task_id) : undefined, unlockedAt: String(row.unlocked_at), dueAt: String(row.due_at), status: row.status === "completed" ? "completed" : "active", completedAt: row.completed_at ? String(row.completed_at) : undefined };
}
export function mapAnnouncement(row: ApiRow): Announcement { return { id: String(row.id), teamId: String(row.team_id), authorId: row.author_id ? String(row.author_id) : undefined, title: String(row.title || ""), content: String(row.content || ""), isActive: Boolean(row.is_active), createdAt: String(row.created_at || new Date().toISOString()), updatedAt: String(row.updated_at || row.created_at || new Date().toISOString()) }; }
export function mapStarAward(row: ApiRow): StarAward { return { id: String(row.id), userId: String(row.user_id), teamId: String(row.team_id), mentorId: row.mentor_id ? String(row.mentor_id) : undefined, stars: Number(row.stars || 0), comment: String(row.comment || ""), createdAt: String(row.created_at || new Date().toISOString()) }; }
export function mapUser(row: ApiRow): User { return { id: String(row.id), name: String(row.name || ""), login: row.login ? String(row.login) : undefined, telegramId: row.telegram_id ? String(row.telegram_id) : undefined, role: row.role === "ceo" ? "ceo" : row.role === "admin" ? "admin" : "member", teamId: row.team_id ? String(row.team_id) : undefined, teamJoinedAt: row.team_joined_at ? String(row.team_joined_at) : undefined, createdAt: String(row.created_at || new Date().toISOString()) }; }
export function mapSubmission(row: ApiRow): Submission { return { id: String(row.id), userId: String(row.user_id), taskId: String(row.task_id), status: row.status === "accepted" || row.status === "revision" ? row.status : "pending", telegramChatId: row.telegram_chat_id ? String(row.telegram_chat_id) : undefined, telegramMessageId: row.telegram_message_id ? String(row.telegram_message_id) : undefined, mediaType: row.media_type === "photo" || row.media_type === "video" || row.media_type === "document" ? row.media_type : undefined, points: Number(row.points || 0), comment: String(row.comment || ""), submittedAt: String(row.submitted_at || new Date().toISOString()), reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined }; }

export type MemberData = { store: Store; ranking: RankEntry[]; starRanking: RankEntry[] };
export async function loadMemberData(userId: string): Promise<MemberData> {
  const [tasksResponse, submissionsResponse, rankingResponse, announcementsResponse, starsResponse] = await Promise.all([
    request<ApiResponse<{ tasks: ApiRow[] }>>("/api/tasks"), request<ApiResponse<{ submissions: ApiRow[] }>>("/api/submissions?userId=" + encodeURIComponent(userId)),
    request<ApiResponse<{ ranking: RankEntry[]; starRanking: RankEntry[] }>>("/api/ranking"), request<ApiResponse<{ announcements: ApiRow[] }>>("/api/announcements"), request<ApiResponse<{ awards: ApiRow[] }>>("/api/stars"),
  ]);
  return { store: { tasks: tasksResponse.tasks.map(mapTask), users: [], programs: [], programProgress: [], announcements: announcementsResponse.announcements.map(mapAnnouncement), starAwards: starsResponse.awards.map(mapStarAward), submissions: submissionsResponse.submissions.map(mapSubmission) }, ranking: rankingResponse.ranking, starRanking: rankingResponse.starRanking || [] };
}
export async function createMemberSubmission(userId: string, taskId: string): Promise<Submission> {
  const response = await request<ApiResponse<{ submission: ApiRow }>>("/api/submissions", { method: "POST", body: JSON.stringify({ userId, taskId }) }); return mapSubmission(response.submission);
}
export async function createTelegramLink(): Promise<{ url?: string; linked: boolean; telegramId?: string }> { const response = await request<ApiResponse<{ url?: string; linked: boolean; telegramId?: string }>>("/api/telegram/link", { method: "POST", body: JSON.stringify({}) }); return { url: response.url, linked: response.linked, telegramId: response.telegramId }; }
export async function loadTelegramLinkStatus(): Promise<{ linked: boolean; telegramId?: string }> { const response = await request<ApiResponse<{ linked: boolean; telegramId?: string }>>("/api/telegram/link/status"); return { linked: response.linked, telegramId: response.telegramId }; }
export function mapAuthUserToUser(user: AuthUser): User { return { ...user, createdAt: new Date().toISOString() }; }
