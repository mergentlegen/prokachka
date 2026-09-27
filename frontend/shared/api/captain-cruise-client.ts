import type { Submission } from "@/shared/domain/types";
import type { CaptainCruiseDetails } from "@/shared/domain/captain-cruise";
import { mapSubmission, request } from "./client";

export type CaptainAttempt = { index: number; failed: boolean; lastAnswer?: number; trainingDone: boolean; screenshotSent: boolean; trainingPoints: number; earnedPoints: number; direction: string; guests?: number[]; cabin?: number; details?: CaptainCruiseDetails; submission?: Submission };
type Operation = "start" | "checkpoint" | "retry" | "finish" | "save-details";
export async function captainAction(taskId: string, operation: Operation, index?: number, payload: Record<string, unknown> = {}): Promise<CaptainAttempt> {
  const { attempt } = await request<{ attempt: Omit<CaptainAttempt, "submission"> & { submission?: Record<string, unknown> } }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, { method: "POST", body: JSON.stringify({ action: "captain", operation, index, payload }) });
  return { ...attempt, submission: attempt.submission ? mapSubmission(attempt.submission) : undefined };
}
export function captainTelegramLink(taskId: string, details: CaptainCruiseDetails) {
  return request<{ url: string }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, { method: "POST", body: JSON.stringify({ action: "captain", operation: "telegram-link", payload: { details } }) });
}
