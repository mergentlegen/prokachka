import { request } from "@/frontend/shared/api/client";

export type ReviewTemplates = { templates: string[]; canEdit: boolean };

export async function loadReviewTemplates(): Promise<ReviewTemplates> {
  const response = await request<{ templates: string[]; canEdit: boolean }>("/api/review-templates", { cache: "no-store" });
  return { templates: response.templates || [], canEdit: Boolean(response.canEdit) };
}

export async function saveReviewTemplates(templates: string[]): Promise<ReviewTemplates> {
  const response = await request<{ templates: string[]; canEdit: boolean }>("/api/review-templates", { method: "PUT", body: JSON.stringify({ templates }) });
  return { templates: response.templates || [], canEdit: true };
}
