"use client";

import { request } from "@/frontend/shared/api/client";
import type { PublicQuizQuestion, QuizAnswers, QuizQuestion } from "@/shared/domain/task-quiz";

type Api<T> = { ok: boolean; message?: string } & T;
const base = (taskId: string) => `/api/tasks/${encodeURIComponent(taskId)}/quiz`;
export type MemberQuiz = { questions: PublicQuizQuestion[]; answers: QuizAnswers; videoRequired: boolean; videoCompleted: boolean };
export type VideoView = { userId: string; completed: boolean; percent: number };

export async function loadQuizForEditing(taskId: string): Promise<QuizQuestion[]> {
  return (await request<Api<{ questions: QuizQuestion[] }>>(`${base(taskId)}?edit=1`, { cache: "no-store" })).questions;
}
export async function saveTaskQuiz(taskId: string, questions: QuizQuestion[]): Promise<QuizQuestion[]> {
  return (await request<Api<{ questions: QuizQuestion[] }>>(base(taskId), { method: "PUT", body: JSON.stringify({ questions }) })).questions;
}
export async function loadMemberQuiz(taskId: string): Promise<MemberQuiz> {
  return (await request<Api<{ quiz: MemberQuiz }>>(base(taskId), { cache: "no-store" })).quiz;
}
export async function saveQuizDraft(taskId: string, answers: QuizAnswers) {
  await request<Api<{ saved: boolean }>>(`${base(taskId)}/draft`, { method: "PUT", body: JSON.stringify({ answers }) });
}
export async function submitTaskQuiz(taskId: string, answers: QuizAnswers) {
  return request<Api<{ score: number; total: number }>>(`${base(taskId)}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
}
export async function loadTaskVideoViews(taskId: string): Promise<VideoView[]> {
  return (await request<Api<{ views: VideoView[] }>>(`/api/tasks/${encodeURIComponent(taskId)}/video/views`, { cache: "no-store" })).views;
}
