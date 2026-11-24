import { mapSubmission, request } from "./client";
import type { Submission } from "@/shared/domain/types";

/** «Правила участия» on the site: the last answer of each question, the right options of rightly answered ones, the miles. */
export type RulesAttempt = {
  answers: Record<number, number>; rights: Record<number, number>;
  earnedPoints: number; maxPoints: number; completed: boolean; submission?: Submission;
};

function readMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => /^[0-9]$/.test(key) && Number.isInteger(item)).map(([key, item]) => [Number(key), Number(item)]));
}

/** start: what is already answered; answer: a try for a question (option index in the site's order); a wrong one can be changed. */
export async function participationRulesAction(taskId: string, operation: "start" | "answer", question = 0, answer = 0): Promise<RulesAttempt> {
  const { attempt } = await request<{ attempt: Record<string, unknown> }>(`/api/ready-programs/${encodeURIComponent(taskId)}/attempt`, {
    method: "POST", body: JSON.stringify({ action: "participation-rules", operation, question, answer }),
  });
  return {
    answers: readMap(attempt.answers), rights: readMap(attempt.rights),
    earnedPoints: Number(attempt.earnedPoints || 0), maxPoints: Number(attempt.maxPoints || 5), completed: Boolean(attempt.completed),
    submission: attempt.submission && typeof attempt.submission === "object" ? mapSubmission(attempt.submission as Record<string, unknown>) : undefined,
  };
}
