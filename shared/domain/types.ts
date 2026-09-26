import type { StarAwardKind } from "./star-awards";

export type UserRole = "ceo" | "admin" | "member";
export type SubmissionStatus = "pending" | "accepted" | "revision";
export type SubmissionSource = "telegram" | "interactive";
export type TeamRequestStatus = "pending" | "approved" | "rejected";
export type TaskPublicationType = "evergreen" | "fixed" | "sequential";
export type ProgramStatus = "active" | "completed";
export const READY_PROGRAM_KEYS = ["dream-plan", "starter-rules"] as const;
export type ReadyProgramKey = typeof READY_PROGRAM_KEYS[number];
export type TaskInteractiveKind = ReadyProgramKey;
export function isReadyProgramKey(value: unknown): value is ReadyProgramKey {
  return typeof value === "string" && (READY_PROGRAM_KEYS as readonly string[]).includes(value);
}
export type TaskAttachment = { id: string; fileName: string; contentType: "application/pdf"; sizeBytes: number; createdAt: string };

export type Team = {
  id: string; name: string; description: string; isActive: boolean; createdAt: string;
};
export type TeamJoinRequest = {
  id: string; userId: string; teamId: string; status: TeamRequestStatus; createdAt: string; reviewedAt?: string; userName?: string; teamName?: string;
  invitedByUserId?: string;
};
export type User = {
  id: string; name: string; login?: string; telegramId?: string; role: UserRole; teamId?: string; teamJoinedAt?: string;
  parentUserId?: string; canReview?: boolean; canPublishTasks?: boolean; canInviteMembers?: boolean; createdAt: string;
};
export type AuthUser = Pick<User, "id" | "name" | "login" | "telegramId" | "role" | "teamId" | "teamJoinedAt" | "parentUserId" | "canReview" | "canPublishTasks" | "canInviteMembers">;

export type TaskProgram = {
  id: string; teamId: string; title: string; deadlineHours: number; isActive: boolean; isPinned?: boolean; publisherId?: string; templateKey?: ReadyProgramKey; createdAt: string; updatedAt: string;
};
export type MemberProgramProgress = {
  id: string; userId: string; programId: string; currentTaskId?: string; unlockedAt: string; dueAt: string; status: ProgramStatus; completedAt?: string;
};
export type Task = {
  id: string; title: string; description: string; maxPoints: number; deadlineAt?: string | null; isActive: boolean; isPinned?: boolean; teamId?: string;
  publicationType?: TaskPublicationType; programId?: string; position?: number; deadlineHours?: number; unlockedAt?: string; dueAt?: string; resourceUrl?: string;
  publisherId?: string; interactiveKind?: TaskInteractiveKind; createdAt: string; updatedAt: string;
  attachments?: TaskAttachment[];
};
export type Announcement = {
  id: string; teamId: string; authorId?: string; title: string; content: string; resourceUrl?: string; isActive: boolean; isPinned?: boolean; createdAt: string; updatedAt: string;
};
export type StarAward = {
  id: string; userId: string; teamId: string; mentorId?: string; mentorName?: string; kind?: StarAwardKind; stars: number; comment: string; createdAt: string;
};
export type Submission = {
  id: string; userId: string; taskId: string; taskTitle?: string; taskMaxPoints?: number; reviewVersion?: number; status: SubmissionStatus; telegramChatId?: string; telegramMessageId?: string;
  source?: SubmissionSource; mediaType?: "text" | "photo" | "video" | "document" | "demo"; answerText?: string;
  points: number; comment: string; submittedAt: string; reviewedAt?: string;
};
export type RankEntry = { id: string; name: string; points: number };
export type Store = {
  users: User[]; tasks: Task[]; programs: TaskProgram[]; programProgress: MemberProgramProgress[];
  announcements: Announcement[]; starAwards: StarAward[]; submissions: Submission[];
};
