import { mapSubmission, request } from "./client";
import type { Submission } from "@/shared/domain/types";
import type { OrgTranscript } from "@/shared/domain/org-environment-engine";

export type OrgResult = {
  attemptId: string; quizOrder: number[]; sortOrder: number[]; blitzOrder: number[];
  score: number; best: number; correct: number; answered: number; rounds: number[];
  completed: boolean; submission?: Submission;
};

function mapResult(row: Record<string, unknown>): OrgResult {
  return {
    attemptId: String(row.attemptId || ""),
    quizOrder: Array.isArray(row.quizOrder) ? row.quizOrder.map(Number) : [],
    sortOrder: Array.isArray(row.sortOrder) ? row.sortOrder.map(Number) : [],
    blitzOrder: Array.isArray(row.blitzOrder) ? row.blitzOrder.map(Number) : [],
    score: Number(row.score || 0), best: Number(row.best || 0),
    correct: Number(row.correct || 0), answered: Number(row.answered || 0),
    rounds: Array.isArray(row.rounds) ? row.rounds.map(Number) : [0, 0, 0],
    completed: Boolean(row.completed),
    submission: row.submission && typeof row.submission === "object" ? mapSubmission(row.submission as Record<string, unknown>) : undefined,
  };
}

export async function orgGameStart(taskId: string): Promise<OrgResult> {
  const { attempt } = await request<{ attempt: Record<string, unknown> }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, {
    method: "POST", body: JSON.stringify({ action: "org-environment", operation: "start" }),
  });
  return mapResult(attempt);
}

export async function orgGameSubmit(taskId: string, transcript: OrgTranscript): Promise<OrgResult> {
  const { attempt } = await request<{ attempt: Record<string, unknown> }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, {
    method: "POST", body: JSON.stringify({ action: "org-environment", operation: "finish", payload: transcript }),
  });
  return mapResult(attempt);
}
