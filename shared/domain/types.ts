export type UserRole = "ceo" | "admin" | "member";
export type SubmissionStatus = "pending" | "accepted" | "revision";
export type TeamRequestStatus = "pending" | "approved" | "rejected";
export type TaskPublicationType = "evergreen" | "fixed" | "sequential";
export type ProgramStatus = "active" | "completed";

export type Team = {
  id: string; name: string; description: string; isActive: boolean; createdAt: string;
};
export type TeamJoinRequest = {
  id: string; userId: string; teamId: string; status: TeamRequestStatus; createdAt: string; reviewedAt?: string; userName?: string; teamName?: string;
};
export type User = {
  id: string; name: string; login?: string; telegramId?: string; role: UserRole; teamId?: string; teamJoinedAt?: string; createdAt: string;
};
export type AuthUser = Pick<User, "id" | "name" | "login" | "telegramId" | "role" | "teamId" | "teamJoinedAt">;

export type TaskProgram = {
  id: string; teamId: string; title: string; deadlineHours: number; isActive: boolean; createdAt: string; updatedAt: string;
};
export type MemberProgramProgress = {
  id: string; userId: string; programId: string; currentTaskId?: string; unlockedAt: string; dueAt: string; status: ProgramStatus; completedAt?: string;
};
export type Task = {
  id: string; title: string; description: string; maxPoints: number; deadlineAt?: string | null; isActive: boolean; teamId?: string;
  publicationType?: TaskPublicationType; programId?: string; position?: number; deadlineHours?: number; unlockedAt?: string; dueAt?: string;
  createdAt: string; updatedAt: string;
};
export type Announcement = {
  id: string; teamId: string; authorId?: string; title: string; content: string; isActive: boolean; createdAt: string; updatedAt: string;
};
export type StarAward = {
  id: string; userId: string; teamId: string; mentorId?: string; stars: number; comment: string; createdAt: string;
};
export type Submission = {
  id: string; userId: string; taskId: string; status: SubmissionStatus; telegramChatId?: string; telegramMessageId?: string;
  mediaType?: "text" | "photo" | "video" | "document" | "demo"; answerText?: string;
  points: number; comment: string; submittedAt: string; reviewedAt?: string;
};
export type RankEntry = { id: string; name: string; points: number };
export type Store = {
  users: User[]; tasks: Task[]; programs: TaskProgram[]; programProgress: MemberProgramProgress[];
  announcements: Announcement[]; starAwards: StarAward[]; submissions: Submission[];
};
