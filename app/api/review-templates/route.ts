import { listReviewTemplates, saveReviewTemplates } from "@/backend/controllers/review-templates.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) {
  return listReviewTemplates(request);
}

export async function PUT(request: Request) {
  const blocked = enforceRequestSecurity(request, "review-templates-update", { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  return saveReviewTemplates(request);
}
