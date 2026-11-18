import { mapSubmission, request } from "./client";
import type { FinalVoyageDream } from "@/shared/domain/final-voyage";
import type { Submission } from "@/shared/domain/types";

/** «Финальный рейс уровня 1» on the site: the step reached, mistakes per step, the dream and, once passed, the right options. */
export type VoyageAttempt = {
  step: number; mistakes: number; log: Record<number, number>; dream: FinalVoyageDream; completed: boolean; earnedPoints: number;
  /** After an answer: whether it was right (the site has already moved one step forward or back). */
  right?: boolean;
  /** Only for a passed game: the right option of each question, for its material. */
  keys?: number[];
  submission?: Submission;
};

const text = (value: unknown) => typeof value === "string" ? value : "";

/** start: where the voyage stopped; answer: an option of the current question; dream: the dream form; complete: the miles. */
export async function finalVoyageAction(taskId: string, operation: "start" | "answer" | "dream" | "complete", step = 0,
  payload: { answer?: number } | FinalVoyageDream = {}): Promise<VoyageAttempt> {
  const { attempt } = await request<{ attempt: Record<string, unknown> }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, {
    method: "POST", body: JSON.stringify({ action: "final-voyage", operation, step, payload }),
  });
  const log = attempt.log && typeof attempt.log === "object" && !Array.isArray(attempt.log) ? attempt.log as Record<string, unknown> : {};
  const dream = attempt.dream && typeof attempt.dream === "object" ? attempt.dream as Record<string, unknown> : {};
  return {
    step: Number(attempt.step || 0), mistakes: Number(attempt.mistakes || 0), completed: Boolean(attempt.completed), earnedPoints: Number(attempt.earnedPoints || 0),
    log: Object.fromEntries(Object.entries(log).filter(([key, count]) => /^[0-9]{1,2}$/.test(key) && Number.isInteger(count)).map(([key, count]) => [Number(key), Number(count)])),
    dream: { what: text(dream.what), price: text(dream.price), when: text(dream.when) },
    right: typeof attempt.right === "boolean" ? attempt.right : undefined,
    keys: Array.isArray(attempt.keys) && attempt.keys.every((key) => Number.isInteger(key)) ? attempt.keys.map(Number) : undefined,
    submission: attempt.submission && typeof attempt.submission === "object" ? mapSubmission(attempt.submission as Record<string, unknown>) : undefined,
  };
}
