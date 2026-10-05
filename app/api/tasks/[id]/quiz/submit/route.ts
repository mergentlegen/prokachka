import { sendTaskQuiz } from "@/backend/controllers/task-quizzes.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-quiz-submit", { max: 10, windowMs: 60_000 });
  if (blocked) return blocked;
  return sendTaskQuiz(request, (await context.params).id);
}
