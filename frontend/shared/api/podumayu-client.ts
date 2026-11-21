import { mapSubmission, request } from "./client";
import type { PodumayuKeys } from "@/shared/domain/podumayu";
import type { Submission } from "@/shared/domain/types";

/** «Тренажёр «Я подумаю»» on the site: the round reached, the mistakes, the marks of the last round and, once passed, the right options. */
export type PodumayuAttempt = {
  step: number; mistakes: number; completed: boolean; earnedPoints: number;
  /** Phrases of the last round already marked: what was chosen and whether it was right. */
  marks: Record<number, { good: boolean; right: boolean }>;
  /** After a pick: whether it was right. */
  right?: boolean;
  keys?: PodumayuKeys;
  submission?: Submission;
};

/** start: where the trainer stopped; answer: an option of the current round; mark: a phrase of the last round; complete: the mile. */
export async function podumayuAction(taskId: string, operation: "start" | "answer" | "mark" | "complete", step = 0,
  payload: { answer?: number } | { item: number; good: boolean } = {}): Promise<PodumayuAttempt> {
  const { attempt } = await request<{ attempt: Record<string, unknown> }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, {
    method: "POST", body: JSON.stringify({ action: "podumayu", operation, step, payload }),
  });
  const marks = attempt.marks && typeof attempt.marks === "object" && !Array.isArray(attempt.marks) ? attempt.marks as Record<string, unknown> : {};
  const keys = attempt.keys && typeof attempt.keys === "object" ? attempt.keys as Record<string, unknown> : null;
  return {
    step: Number(attempt.step || 0), mistakes: Number(attempt.mistakes || 0), completed: Boolean(attempt.completed), earnedPoints: Number(attempt.earnedPoints || 0),
    marks: Object.fromEntries(Object.entries(marks).filter(([key, mark]) => /^[0-3]$/.test(key) && mark && typeof mark === "object")
      .map(([key, mark]) => [Number(key), { good: Boolean((mark as Record<string, unknown>).good), right: Boolean((mark as Record<string, unknown>).right) }])),
    right: typeof attempt.right === "boolean" ? attempt.right : undefined,
    keys: keys && Array.isArray(keys.answers) && Array.isArray(keys.sort) && keys.answers.every((key) => Number.isInteger(key)) && keys.sort.every((key) => typeof key === "boolean")
      ? { answers: keys.answers.map(Number), sort: keys.sort.map(Boolean) } : undefined,
    submission: attempt.submission && typeof attempt.submission === "object" ? mapSubmission(attempt.submission as Record<string, unknown>) : undefined,
  };
}
