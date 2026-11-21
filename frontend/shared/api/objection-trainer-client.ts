import { mapSubmission, request } from "./client";
import type { ObjectionTrainerData, TrainerKeys } from "@/shared/domain/objection-trainer";
import type { Submission } from "@/shared/domain/types";

/** An objection trainer on the site: the round reached, the mistakes, the marks of the sorting round and, once passed, the right options. */
export type TrainerAttempt = {
  step: number; mistakes: number; completed: boolean; earnedPoints: number;
  /** Phrases of the sorting round already marked: what was chosen and whether it was right. */
  marks: Record<number, { good: boolean; right: boolean }>;
  /** After a pick: whether it was right. */
  right?: boolean;
  keys?: TrainerKeys;
  submission?: Submission;
};
export type TrainerOperation = "start" | "answer" | "mark" | "complete";

/** start: where the trainer stopped; answer: an option of the current round; mark: a phrase of the sorting round; complete: the mile. */
export async function trainerAction(kind: ObjectionTrainerData["kind"], taskId: string, operation: TrainerOperation, step = 0,
  payload: { answer?: number } | { item: number; good: boolean } = {}): Promise<TrainerAttempt> {
  const { attempt } = await request<{ attempt: Record<string, unknown> }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, {
    method: "POST", body: JSON.stringify({ action: kind, operation, step, payload }),
  });
  const marks = attempt.marks && typeof attempt.marks === "object" && !Array.isArray(attempt.marks) ? attempt.marks as Record<string, unknown> : {};
  const keys = attempt.keys && typeof attempt.keys === "object" ? attempt.keys as Record<string, unknown> : null;
  return {
    step: Number(attempt.step || 0), mistakes: Number(attempt.mistakes || 0), completed: Boolean(attempt.completed), earnedPoints: Number(attempt.earnedPoints || 0),
    marks: Object.fromEntries(Object.entries(marks).filter(([key, mark]) => /^\d$/.test(key) && mark && typeof mark === "object")
      .map(([key, mark]) => [Number(key), { good: Boolean((mark as Record<string, unknown>).good), right: Boolean((mark as Record<string, unknown>).right) }])),
    right: typeof attempt.right === "boolean" ? attempt.right : undefined,
    keys: keys && Array.isArray(keys.answers) && Array.isArray(keys.sort) && keys.answers.every((key) => Number.isInteger(key)) && keys.sort.every((key) => typeof key === "boolean")
      ? { answers: keys.answers.map(Number), sort: keys.sort.map(Boolean) } : undefined,
    submission: attempt.submission && typeof attempt.submission === "object" ? mapSubmission(attempt.submission as Record<string, unknown>) : undefined,
  };
}
