import type { Announcement, RankEntry, StarAward, Store, Submission, Task, TaskProgram } from "@/shared/domain/types";
import { mapAnnouncement, mapProgram, mapStarAward, mapSubmission, mapTask, mapUser, request } from "@/frontend/shared/api/client";
type ApiRow = Record<string, unknown>;
type ApiResponse<T> = { ok: boolean; message?: string } & T;
export type ProgramHistoryStatus = "on_time" | "active" | "late" | "missed" | "completed" | "locked";
export type ProgramHistoryStepMember = { userId: string; name: string; status: Exclude<ProgramHistoryStatus, "completed">; dueAt?: string; submittedAt?: string; points?: number };
export type ProgramHistoryMember = { userId: string; name: string; status: ProgramHistoryStatus; currentStep?: number; currentTaskTitle?: string; dueAt?: string; submittedAt?: string; points?: number };
export type ProgramHistory = { id: string; teamId: string; title: string; deadlineHours: number; isActive: boolean; createdAt: string; steps: Array<{ id: string; title: string; position: number; maxPoints: number; deadlineHours: number; members: ProgramHistoryStepMember[] }>; members: ProgramHistoryMember[] };

export async function loadAdminData(): Promise<Store> {
  const [tasksResponse, usersResponse, submissionsResponse, announcementsResponse, starsResponse, programsResponse] = await Promise.all([
    request<ApiResponse<{ tasks: ApiRow[] }>>("/api/tasks"), request<ApiResponse<{ users: ApiRow[] }>>("/api/users"),
    request<ApiResponse<{ submissions: ApiRow[] }>>("/api/submissions"), request<ApiResponse<{ announcements: ApiRow[] }>>("/api/announcements"),
    request<ApiResponse<{ awards: ApiRow[] }>>("/api/stars"), request<ApiResponse<{ programs: ApiRow[] }>>("/api/programs"),
  ]);
  return { tasks: tasksResponse.tasks.map(mapTask), users: usersResponse.users.map(mapUser), programs: programsResponse.programs.map(mapProgram), programProgress: [], announcements: announcementsResponse.announcements.map(mapAnnouncement), starAwards: starsResponse.awards.map(mapStarAward), submissions: submissionsResponse.submissions.map(mapSubmission) };
}
export async function loadAdminProgramHistory(): Promise<ProgramHistory[]> {
  const response = await request<ApiResponse<{ programs: ProgramHistory[] }>>("/api/programs/history");
  return response.programs || [];
}
export async function createAdminTask(input: Pick<Task, "title" | "description" | "maxPoints" | "deadlineAt">): Promise<Task> {
  const response = await request<ApiResponse<{ task: ApiRow }>>("/api/tasks", { method: "POST", body: JSON.stringify(input) }); return mapTask(response.task);
}
export async function updateAdminTask(id: string, input: Partial<Pick<Task, "title" | "description" | "maxPoints" | "deadlineAt" | "isActive">>): Promise<Task> {
  const response = await request<ApiResponse<{ task: ApiRow }>>("/api/tasks/" + id, { method: "PATCH", body: JSON.stringify(input) }); return mapTask(response.task);
}
export async function deleteAdminTask(id: string) { await request<ApiResponse<Record<string, never>>>("/api/tasks/" + id, { method: "DELETE" }); }
export async function reviewAdminSubmission(id: string, input: { status: "accepted" | "revision"; points: number; comment: string }): Promise<Submission> {
  const response = await request<ApiResponse<{ submission: ApiRow }>>("/api/submissions/" + id + "/review", { method: "PATCH", body: JSON.stringify(input) }); return mapSubmission(response.submission);
}
export async function createAdminAnnouncement(input: Pick<Announcement, "title" | "content">): Promise<Announcement> { const response = await request<ApiResponse<{ announcement: ApiRow }>>("/api/announcements", { method: "POST", body: JSON.stringify(input) }); return mapAnnouncement(response.announcement); }
export async function updateAdminAnnouncement(id: string, input: Partial<Pick<Announcement, "title" | "content" | "isActive">>): Promise<Announcement> { const response = await request<ApiResponse<{ announcement: ApiRow }>>("/api/announcements/" + id, { method: "PATCH", body: JSON.stringify(input) }); return mapAnnouncement(response.announcement); }
export async function deleteAdminAnnouncement(id: string) { await request<ApiResponse<Record<string, never>>>("/api/announcements/" + id, { method: "DELETE" }); }
export async function createAdminStarAward(input: { userId: string; stars: number; comment: string }): Promise<StarAward> { const response = await request<ApiResponse<{ award: ApiRow }>>("/api/stars", { method: "POST", body: JSON.stringify(input) }); return mapStarAward(response.award); }
export async function deleteAdminStarAward(id: string) { await request<ApiResponse<Record<string, never>>>("/api/stars/" + id, { method: "DELETE" }); }
export type ProgramCreateInput = { title: string; deadlineHours: number; tasks: Array<{ title: string; description: string; maxPoints: number }> };
export async function createAdminProgram(input: ProgramCreateInput): Promise<{ program: TaskProgram; tasks: Task[] }> {
  const response = await request<ApiResponse<{ program: ApiRow; tasks: ApiRow[] }>>("/api/programs", { method: "POST", body: JSON.stringify(input) });
  return { program: mapProgram(response.program), tasks: response.tasks.map(mapTask) };
}
export async function updateAdminProgram(id: string, input: { title?: string; deadlineHours?: number; isActive?: boolean }): Promise<TaskProgram> {
  const response = await request<ApiResponse<{ program: ApiRow }>>("/api/programs/" + id, { method: "PATCH", body: JSON.stringify(input) }); return mapProgram(response.program);
}
