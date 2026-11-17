import { mapSubmission, request } from "./client";
import type { Submission } from "@/shared/domain/types";

/** Mistakes and hints the participant made; `log` says where (`m3` — mission 3, `q2` — question 2 of the check). */
export type TrainerStats = { errors: number; hints: number; log: Record<string, number> };
export type TrainerAttempt = { missions: number; stats: TrainerStats; completed: boolean; earnedPoints: number; submission?: Submission };
export type TrainerPayload = Partial<TrainerStats> & { answer?: number; answers?: number[] };
export type TrainerOperation = "start" | "save" | "complete";

function readStats(value: unknown): TrainerStats {
  const stats = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const log = stats.log && typeof stats.log === "object" && !Array.isArray(stats.log) ? stats.log as Record<string, unknown> : {};
  return {
    errors: Number(stats.errors || 0), hints: Number(stats.hints || 0),
    log: Object.fromEntries(Object.entries(log).filter(([, count]) => Number(count) > 0).map(([key, count]) => [key, Number(count)])),
  };
}

/** A cabinet trainer (`kind`) — start: where it stopped; save: a passed mission (with its answer); complete: the check and the miles. */
export async function cabinetTrainerAction(kind: string, taskId: string, operation: TrainerOperation, step = 0, payload: TrainerPayload = {}): Promise<TrainerAttempt> {
  const { attempt } = await request<{ attempt: Record<string, unknown> }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, {
    method: "POST", body: JSON.stringify({ action: kind, operation, step, payload }),
  });
  return {
    missions: Number(attempt.step || 0), stats: readStats(attempt.stats),
    completed: Boolean(attempt.completed), earnedPoints: Number(attempt.earnedPoints || 0),
    submission: attempt.submission && typeof attempt.submission === "object" ? mapSubmission(attempt.submission as Record<string, unknown>) : undefined,
  };
}
