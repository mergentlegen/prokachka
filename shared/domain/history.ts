export type ProgramHistoryStatus = "on_time" | "active" | "late" | "missed" | "completed" | "locked";
export type ProgramHistoryStepMember = {
  userId: string;
  name: string;
  status: Exclude<ProgramHistoryStatus, "completed">;
  dueAt?: string;
  submittedAt?: string;
  points?: number;
};
export type ProgramHistoryMember = {
  userId: string;
  name: string;
  status: ProgramHistoryStatus;
  currentStep?: number;
  currentTaskTitle?: string;
  dueAt?: string;
  submittedAt?: string;
  points?: number;
};
export type ProgramHistoryStep = {
  id: string;
  title: string;
  position: number;
  maxPoints: number;
  deadlineHours: number;
  members: ProgramHistoryStepMember[];
};
export type ProgramHistory = {
  id: string;
  teamId: string;
  title: string;
  deadlineHours: number;
  isActive: boolean;
  publisherId?: string;
  publisherName?: string;
  createdAt: string;
  steps: ProgramHistoryStep[];
  members: ProgramHistoryMember[];
};

export type PublicationHistoryItem = {
  id: string;
  type: "task" | "program" | "announcement";
  title: string;
  authorId?: string;
  authorName: string;
  teamId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deadlineAt?: string;
  stepCount?: number;
};
