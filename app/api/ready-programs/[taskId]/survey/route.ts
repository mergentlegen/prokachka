import { postHeartSurvey } from "@/backend/controllers/heart-survey.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const blocked = enforceRequestSecurity(request, "heart-survey", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return postHeartSurvey(request, (await context.params).taskId);
}
