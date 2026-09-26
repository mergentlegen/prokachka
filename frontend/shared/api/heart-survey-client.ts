import type { SurveyDefinition } from "@/shared/domain/heart-survey";
import type { Submission } from "@/shared/domain/types";
import { mapSubmission, request } from "./client";

export type HeartSurveyState = { questionIndex: number; earnedPoints: number; answers: number[]; completed: boolean; definition: SurveyDefinition; submission?: Submission; delivery: { total: number; sent: number; waiting: number } };

export async function heartSurveyRequest(taskId: string, answer?: number, questionIndex?: number): Promise<HeartSurveyState> {
  const response = await request<{ survey: Omit<HeartSurveyState, "submission"> & { submission?: Record<string, unknown> } }>(`/api/ready-programs/${encodeURIComponent(taskId)}/survey`, { method: "POST", body: JSON.stringify(answer === undefined ? { action: "start" } : { action: "answer", answer, questionIndex }) });
  return { ...response.survey, submission: response.survey.submission ? mapSubmission(response.survey.submission) : undefined };
}
