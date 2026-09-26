import type { Submission } from "@/shared/domain/types";
import { mapSubmission, request } from "./client";

export type ReadyAttempt = {
  attemptId: string;
  step: number;
  status: "active" | "completed";
  attemptNumber: number;
  earnedPoints: number;
  maxPoints: number;
  questionIndex: number;
  answeredQuestions: number;
  completed: boolean;
  ready?: boolean;
  failed?: boolean;
  lastAnswer?: number | null;
  reset?: boolean;
  message?: string;
  submission?: Submission;
};

type ApiRow = Record<string, unknown>;

function mapAttempt(row: ApiRow): ReadyAttempt {
  const rawSubmission = row.submission;
  return {
    attemptId: String(row.attemptId || ""),
    step: Number(row.step || 0),
    status: row.status === "completed" ? "completed" : "active",
    attemptNumber: Number(row.attemptNumber || 1),
    earnedPoints: Number(row.earnedPoints || row.points || 0),
    maxPoints: Number(row.maxPoints || 0),
    questionIndex: Number(row.questionIndex || 0),
    answeredQuestions: Number(row.answeredQuestions || row.questionIndex || 0),
    completed: Boolean(row.completed),
    ready: Boolean(row.ready),
    failed: Boolean(row.failed),
    lastAnswer: Number.isInteger(row.lastAnswer) ? Number(row.lastAnswer) : null,
    reset: Boolean(row.reset),
    message: typeof row.message === "string" ? row.message : undefined,
    submission: rawSubmission && typeof rawSubmission === "object" ? mapSubmission(rawSubmission as ApiRow) : undefined,
  };
}

async function mutate(taskId: string, body: Record<string, unknown>) {
  const response = await request<{ attempt: ApiRow }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, { method: "POST", body: JSON.stringify(body) });
  return mapAttempt(response.attempt);
}

export function startReadyProgram(taskId: string, restart = false) { return mutate(taskId, { action: "start", restart }); }
export function advanceReadyProgram(taskId: string, step: number) { return mutate(taskId, { action: "advance", step }); }
export function answerReadyProgram(taskId: string, answer: number, questionIndex?: number) { return mutate(taskId, { action: "answer", answer, questionIndex }); }
export function restartReadyProgramQuiz(taskId: string) { return mutate(taskId, { action: "restart-quiz" }); }
export function completeReadyProgram(taskId: string) { return mutate(taskId, { action: "complete" }); }
