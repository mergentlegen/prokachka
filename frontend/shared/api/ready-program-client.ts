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
  storyChoices?: number[];
  /** Company game: the current question was answered wrong and is answered again. */
  wrong?: boolean;
  mistakes?: number;
  firstTry?: number;
  /** Company game: finished in the old version (miles were given by the site). */
  legacy?: boolean;
  /** Company game: the latest voice sent to the mentor. */
  voice?: { status: "pending" | "accepted" | "revision"; points: number; comment: string } | null;
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
    storyChoices: Array.isArray(row.storyChoices) && row.storyChoices.length === 3 && row.storyChoices.every(Number.isInteger) ? row.storyChoices as number[] : undefined,
    wrong: Boolean(row.wrong), mistakes: Number(row.mistakes || 0), firstTry: Number(row.firstTry || 0), legacy: Boolean(row.legacy),
    voice: mapVoice(row.voice),
  };
}

function mapVoice(value: unknown): ReadyAttempt["voice"] {
  if (!value || typeof value !== "object") return null;
  const row = value as ApiRow;
  const status = row.status === "accepted" || row.status === "revision" || row.status === "pending" ? row.status : null;
  return status ? { status, points: Number(row.points || 0), comment: typeof row.comment === "string" ? row.comment : "" } : null;
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
export function saveCompanyStory(taskId: string, choices: number[]) { return mutate(taskId, { action: "save-story", choices }); }
export async function createCompanyVoiceLink(taskId: string) {
  return request<{ url: string }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, { method: "POST", body: JSON.stringify({ action: "voice-link" }) });
}
