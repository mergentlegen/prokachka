import { mapSubmission, request } from "./client";
import type { Submission } from "@/shared/domain/types";

export type SafetyWatchAttempt = { decks: number; fixes: number; seen: number; completed: boolean; earnedPoints: number; submission?: Submission };

/** start: where the watch stopped; save: a finished deck (its answers in the deck's order); complete: the miles. */
export async function safetyWatchAction(taskId: string, operation: "start" | "save" | "complete", deck = 0, payload: { answers?: number[]; fixes?: number; seen?: number } = {}): Promise<SafetyWatchAttempt> {
  const { attempt } = await request<{ attempt: Record<string, unknown> }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, {
    method: "POST", body: JSON.stringify({ action: "safety-watch", operation, step: deck, payload }),
  });
  const stats = attempt.stats && typeof attempt.stats === "object" ? attempt.stats as Record<string, unknown> : {};
  return {
    decks: Number(attempt.step || 0), fixes: Number(stats.fixes || 0), seen: Number(stats.seen || 0),
    completed: Boolean(attempt.completed), earnedPoints: Number(attempt.earnedPoints || 0),
    submission: attempt.submission && typeof attempt.submission === "object" ? mapSubmission(attempt.submission as Record<string, unknown>) : undefined,
  };
}
