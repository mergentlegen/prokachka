import { mapSubmission, request } from "./client";
import type { Submission } from "@/shared/domain/types";

/** Mistakes and hints the participant made; `log` says where (`m3` — mission 3, `q2` — question 2 of the check). */
export type FreeMembershipStats = { errors: number; hints: number; log: Record<string, number> };
export type FreeMembershipAttempt = { missions: number; stats: FreeMembershipStats; completed: boolean; earnedPoints: number; submission?: Submission };
export type FreeMembershipPayload = Partial<FreeMembershipStats> & { answer?: number; answers?: number[] };

function readStats(value: unknown): FreeMembershipStats {
  const stats = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const log = stats.log && typeof stats.log === "object" && !Array.isArray(stats.log) ? stats.log as Record<string, unknown> : {};
  return {
    errors: Number(stats.errors || 0), hints: Number(stats.hints || 0),
    log: Object.fromEntries(Object.entries(log).filter(([, count]) => Number(count) > 0).map(([key, count]) => [key, Number(count)])),
  };
}

/** start: where the trainer stopped; save: a passed mission (with its answer); complete: the check and the miles. */
export async function freeMembershipAction(taskId: string, operation: "start" | "save" | "complete", step = 0, payload: FreeMembershipPayload = {}): Promise<FreeMembershipAttempt> {
  const { attempt } = await request<{ attempt: Record<string, unknown> }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, {
    method: "POST", body: JSON.stringify({ action: "free-membership", operation, step, payload }),
  });
  return {
    missions: Number(attempt.step || 0), stats: readStats(attempt.stats),
    completed: Boolean(attempt.completed), earnedPoints: Number(attempt.earnedPoints || 0),
    submission: attempt.submission && typeof attempt.submission === "object" ? mapSubmission(attempt.submission as Record<string, unknown>) : undefined,
  };
}
