import { mapSubmission, request } from "./client";
import type { Submission } from "@/shared/domain/types";

export type CountDreamAttempt = { step: number; answers: Record<string, unknown>; completed: boolean; earnedPoints: number; submission?: Submission };

export async function countDreamAction(taskId: string, operation: "start" | "save" | "complete", step = 0, answers: Record<string, unknown> = {}): Promise<CountDreamAttempt> {
  const { attempt } = await request<{ attempt: Record<string, unknown> }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, {
    method: "POST", body: JSON.stringify({ action: "count-dream", operation, step, payload: answers }),
  });
  return {
    step: Number(attempt.step || 0), answers: attempt.answers && typeof attempt.answers === "object" ? attempt.answers as Record<string, unknown> : {},
    completed: Boolean(attempt.completed), earnedPoints: Number(attempt.earnedPoints || 0),
    submission: attempt.submission && typeof attempt.submission === "object" ? mapSubmission(attempt.submission as Record<string, unknown>) : undefined,
  };
}
