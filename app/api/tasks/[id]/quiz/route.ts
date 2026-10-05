import { readTaskQuiz, writeTaskQuiz } from "@/backend/controllers/task-quizzes.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-quiz", { max: 120, windowMs: 60_000 });
  if (blocked) return blocked;
  return readTaskQuiz(request, (await context.params).id);
}
export async function PUT(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "task-quiz-save", { max: 30, windowMs: 60_000, maxBodyBytes: 256 * 1024 });
  if (blocked) return blocked;
  return writeTaskQuiz(request, (await context.params).id);
}
