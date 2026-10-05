import { writeTaskQuizDraft } from "@/backend/controllers/task-quizzes.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-quiz-draft", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return writeTaskQuizDraft(request, (await context.params).id);
}
