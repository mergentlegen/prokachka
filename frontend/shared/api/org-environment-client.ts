import { mapSubmission, request } from "./client";
import type { Submission } from "@/shared/domain/types";

export type OrgPhase = "intro1" | "quiz" | "intro2" | "sort" | "intro3" | "blitz" | "done";
export type OrgAttempt = {
  phase: OrgPhase; index: number; quizOrder: number[]; sortOrder: number[]; blitzOrder: number[];
  serverNow: string; questionStarted?: string; blitzStarted?: string; score: number; streak: number; best: number;
  correct: number; answered: number; rounds: number[]; completed: boolean; awaitNext: boolean; expired?: boolean;
  last?: { phase: OrgPhase; index: number; choice: number | null; correct: boolean; expected: number; delta: number; timedOut: boolean };
  submission?: Submission;
};

export async function orgGameAction(taskId: string, operation: "start" | "begin" | "answer" | "advance" | "finish", index?: number, answer?: number | null): Promise<OrgAttempt> {
  const { attempt } = await request<{ attempt: Record<string, unknown> }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, {
    method: "POST", body: JSON.stringify({ action: "org-environment", operation, index, answer }),
  });
  const row = attempt;
  return {
    phase: row.phase as OrgPhase, index: Number(row.index || 0),
    quizOrder: Array.isArray(row.quizOrder) ? row.quizOrder.map(Number) : [],
    sortOrder: Array.isArray(row.sortOrder) ? row.sortOrder.map(Number) : [],
    blitzOrder: Array.isArray(row.blitzOrder) ? row.blitzOrder.map(Number) : [],
    serverNow: typeof row.serverNow === "string" ? row.serverNow : new Date().toISOString(),
    questionStarted: typeof row.questionStarted === "string" ? row.questionStarted : undefined,
    blitzStarted: typeof row.blitzStarted === "string" ? row.blitzStarted : undefined,
    score: Number(row.score || 0), streak: Number(row.streak || 0), best: Number(row.best || 0),
    correct: Number(row.correct || 0), answered: Number(row.answered || 0),
    rounds: Array.isArray(row.rounds) ? row.rounds.map(Number) : [0, 0, 0],
    completed: Boolean(row.completed), awaitNext: Boolean(row.awaitNext), expired: Boolean(row.expired),
    last: row.last && typeof row.last === "object" ? row.last as OrgAttempt["last"] : undefined,
    submission: row.submission && typeof row.submission === "object" ? mapSubmission(row.submission as Record<string, unknown>) : undefined,
  };
}
