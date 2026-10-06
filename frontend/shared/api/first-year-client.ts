import { mapSubmission, request } from "./client";
import type { Submission } from "@/shared/domain/types";

export type FirstYearAttempt = { step: number; choices: number[]; completed: boolean; earnedPoints: number; submission?: Submission };

export async function firstYearAction(taskId: string, operation: "start" | "save" | "complete", step = 0, choices: number[] = []): Promise<FirstYearAttempt> {
  const { attempt } = await request<{ attempt: Record<string, unknown> }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, {
    method: "POST", body: JSON.stringify({ action: "first-year", operation, step, payload: { choices } }),
  });
  const answers = attempt.answers && typeof attempt.answers === "object" ? attempt.answers as Record<string, unknown> : {};
  return {
    step: Number(attempt.step || 0),
    choices: Array.isArray(answers.choices) ? answers.choices.filter((value): value is number => Number.isInteger(value)) : [],
    completed: Boolean(attempt.completed), earnedPoints: Number(attempt.earnedPoints || 0),
    submission: attempt.submission && typeof attempt.submission === "object" ? mapSubmission(attempt.submission as Record<string, unknown>) : undefined,
  };
}
