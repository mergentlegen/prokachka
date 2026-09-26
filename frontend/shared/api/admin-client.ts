import type { Announcement, RankEntry, StarAward, Store, Submission, Task, TaskProgram } from "@/shared/domain/types";
import type { ReadyProgramDefinition } from "@/shared/domain/ready-programs";
import type { ReadyProgramKey } from "@/shared/domain/types";
import type { StarAwardKind } from "@/shared/domain/star-awards";
import { mapAnnouncement, mapProgram, mapStarAward, mapSubmission, mapTask, mapUser, request } from "@/frontend/shared/api/client";
type ApiRow = Record<string, unknown>;
type ApiResponse<T> = { ok: boolean; message?: string } & T;
import type { ProgramHistory, PublicationHistoryItem } from "@/shared/domain/history";
export type { ProgramHistory, PublicationHistoryItem } from "@/shared/domain/history";

export type AdminDataset = Exclude<keyof Store, "programProgress">;
const datasetLoaders: { [K in AdminDataset]: () => Promise<Store[K]> } = {
  tasks: async () => (await request<ApiResponse<{ tasks: ApiRow[] }>>("/api/tasks")).tasks.map(mapTask),
  users: async () => (await request<ApiResponse<{ users: ApiRow[] }>>("/api/users")).users.map(mapUser),
  submissions: async () => (await request<ApiResponse<{ submissions: ApiRow[] }>>("/api/submissions")).submissions.map(mapSubmission),
  announcements: async () => (await request<ApiResponse<{ announcements: ApiRow[] }>>("/api/announcements")).announcements.map(mapAnnouncement),
  starAwards: async () => (await request<ApiResponse<{ awards: ApiRow[] }>>("/api/stars")).awards.map(mapStarAward),
  programs: async () => (await request<ApiResponse<{ programs: ApiRow[] }>>("/api/programs")).programs.map(mapProgram),
};
export async function loadAdminData(keys: readonly AdminDataset[]): Promise<Partial<Store>> {
  const entries = await Promise.all([...new Set(keys)].map(async (key) => [key, await datasetLoaders[key]()]));
  return Object.fromEntries(entries);
}
export async function loadAdminRanking(): Promise<RankEntry[]> {
  return (await request<ApiResponse<{ ranking: RankEntry[] }>>("/api/ranking")).ranking;
}
export type MentorCounts = { pending: number; accepted: number; requests: number };
export async function loadMentorCounts(): Promise<MentorCounts> {
  return (await request<ApiResponse<{ counts: MentorCounts }>>("/api/submissions?summary=1")).counts;
}
export async function loadAdminProgramHistory(): Promise<ProgramHistory[]> {
  const response = await request<ApiResponse<{ programs: ProgramHistory[] }>>("/api/programs/history");
  return response.programs || [];
}
export async function loadAdminPublicationHistory(): Promise<PublicationHistoryItem[]> {
  const response = await request<ApiResponse<{ history: PublicationHistoryItem[] }>>("/api/publication-history");
  return response.history || [];
}
type AdminTaskInput = Omit<Pick<Task, "title" | "description" | "maxPoints" | "deadlineAt" | "resourceUrl">, "resourceUrl"> & { resourceUrl?: string | null };
type AdminTaskPatch = Partial<Omit<Pick<Task, "title" | "description" | "maxPoints" | "deadlineAt" | "resourceUrl" | "isActive" | "isPinned">, "resourceUrl"> & { resourceUrl?: string | null }>;
export async function createAdminTask(input: AdminTaskInput): Promise<Task> {
  const response = await request<ApiResponse<{ task: ApiRow }>>("/api/tasks", { method: "POST", body: JSON.stringify(input) }); return mapTask(response.task);
}
export async function updateAdminTask(id: string, input: AdminTaskPatch): Promise<Task> {
  const response = await request<ApiResponse<{ task: ApiRow }>>("/api/tasks/" + id, { method: "PATCH", body: JSON.stringify(input) }); return mapTask(response.task);
}
export async function deleteAdminTask(id: string): Promise<boolean> { const response = await request<ApiResponse<{ storageCleanupWarning?: boolean }>>("/api/tasks/" + id, { method: "DELETE" }); return Boolean(response.storageCleanupWarning); }
export async function reviewAdminSubmission(id: string, input: { status: "accepted" | "revision"; points: number; comment: string; expectedVersion: number }): Promise<Submission> {
  const response = await request<ApiResponse<{ submission: ApiRow }>>("/api/submissions/" + id + "/review", { method: "PATCH", body: JSON.stringify(input) }); return mapSubmission(response.submission);
}
type AdminAnnouncementInput = Omit<Pick<Announcement, "title" | "content" | "resourceUrl">, "resourceUrl"> & { resourceUrl?: string | null };
type AdminAnnouncementPatch = Partial<Omit<Pick<Announcement, "title" | "content" | "resourceUrl" | "isActive" | "isPinned">, "resourceUrl"> & { resourceUrl?: string | null }>;
export async function createAdminAnnouncement(input: AdminAnnouncementInput): Promise<Announcement> { const response = await request<ApiResponse<{ announcement: ApiRow }>>("/api/announcements", { method: "POST", body: JSON.stringify(input) }); return mapAnnouncement(response.announcement); }
export async function updateAdminAnnouncement(id: string, input: AdminAnnouncementPatch): Promise<Announcement> { const response = await request<ApiResponse<{ announcement: ApiRow }>>("/api/announcements/" + id, { method: "PATCH", body: JSON.stringify(input) }); return mapAnnouncement(response.announcement); }
export async function deleteAdminAnnouncement(id: string) { await request<ApiResponse<Record<string, never>>>("/api/announcements/" + id, { method: "DELETE" }); }
export async function createAdminStarAward(input: { userId: string; kind: StarAwardKind; comment: string }): Promise<StarAward> { const response = await request<ApiResponse<{ award: ApiRow }>>("/api/stars", { method: "POST", body: JSON.stringify(input) }); return mapStarAward(response.award); }
export async function deleteAdminStarAward(id: string) { await request<ApiResponse<Record<string, never>>>("/api/stars/" + id, { method: "DELETE" }); }
export type ProgramCreateInput = { title: string; deadlineHours: number; tasks: Array<{ title: string; description: string; maxPoints: number; resourceUrl?: string | null }> };
export async function createAdminProgram(input: ProgramCreateInput): Promise<{ program: TaskProgram; tasks: Task[] }> {
  const response = await request<ApiResponse<{ program: ApiRow; tasks: ApiRow[] }>>("/api/programs", { method: "POST", body: JSON.stringify(input) });
  return { program: mapProgram(response.program), tasks: response.tasks.map(mapTask) };
}
export async function updateAdminProgram(id: string, input: { title?: string; deadlineHours?: number; isActive?: boolean; isPinned?: boolean }): Promise<TaskProgram> {
  const response = await request<ApiResponse<{ program: ApiRow }>>("/api/programs/" + id, { method: "PATCH", body: JSON.stringify(input) }); return mapProgram(response.program);
}
export async function deleteAdminProgram(id: string): Promise<boolean> { const response = await request<ApiResponse<{ storageCleanupWarning?: boolean }>>("/api/programs/" + id, { method: "DELETE" }); return Boolean(response.storageCleanupWarning); }
export type ReadyProgramStatus = Omit<ReadyProgramDefinition, "tasks"> & { published: boolean; publishedProgramId?: string; publishedActive?: boolean; publishedPinned?: boolean; publishedCreatedAt?: string; canManage?: boolean };
export async function loadReadyPrograms(): Promise<ReadyProgramStatus[]> {
  const response = await request<ApiResponse<{ readyPrograms: ReadyProgramStatus[] }>>("/api/ready-programs");
  return response.readyPrograms || [];
}
export async function publishReadyProgram(key: ReadyProgramKey): Promise<{ program: TaskProgram; tasks: Task[]; alreadyPublished: boolean }> {
  const response = await request<ApiResponse<{ program: ApiRow; tasks: ApiRow[]; alreadyPublished?: boolean }>>("/api/ready-programs", { method: "POST", body: JSON.stringify({ key }) });
  return { program: mapProgram(response.program), tasks: response.tasks.map(mapTask), alreadyPublished: Boolean(response.alreadyPublished) };
}
