import { getCurrentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { scheduleTelegramDelivery } from "@/backend/services/telegram-notifications.service";
import { getQuizForEditing, getQuizForMember, saveQuiz, saveQuizDraft, submitQuiz, taskVideoViews } from "@/backend/services/task-quizzes.service";

async function signedIn(request: Request, taskId: string) {
  if (!isUuid(taskId)) return { response: failure("Некорректное задание.", 400) };
  const user = await getCurrentUser(request);
  if (!user) return { response: failure("Сначала войдите в аккаунт.", 401) };
  return { user };
}

// ?edit=1 returns the mentor's copy with correct choices; otherwise the participant's view.
export async function readTaskQuiz(request: Request, taskId: string) {
  const { user, response } = await signedIn(request, taskId);
  if (!user) return response;
  if (new URL(request.url).searchParams.get("edit") === "1") {
    const result = await getQuizForEditing(user, taskId);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("Изменять вопросы может автор задания или руководитель команды.", 403);
    if ("error" in result) return failure("Не удалось загрузить вопросы.", 503);
    return ok({ questions: result.data });
  }
  const result = await getQuizForMember(user, taskId);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("notFound" in result) return failure("У задания нет вопросов.", 404);
  if ("forbidden" in result) return failure("Задание недоступно.", 403);
  if ("error" in result) return failure("Не удалось загрузить вопросы.", 503);
  return ok({ quiz: result.data });
}

export async function writeTaskQuiz(request: Request, taskId: string) {
  const { user, response } = await signedIn(request, taskId);
  if (!user) return response;
  try {
    const body = await readLimitedJson(request);
    const result = await saveQuiz(user, taskId, body.questions);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("validationError" in result) return failure(result.validationError || "Проверьте вопросы.", 400);
    if ("forbidden" in result) return failure("Изменять вопросы может автор задания или руководитель команды.", 403);
    if ("error" in result) return failure("Не удалось сохранить вопросы.", 503);
    return ok({ questions: result.data });
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

export async function writeTaskQuizDraft(request: Request, taskId: string) {
  const { user, response } = await signedIn(request, taskId);
  if (!user) return response;
  try {
    const body = await readLimitedJson(request);
    const result = await saveQuizDraft(user, taskId, body.answers);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("notFound" in result || "forbidden" in result) return failure("Задание недоступно.", 403);
    if ("error" in result) return failure("Не удалось сохранить черновик.", 503);
    return ok({ saved: true });
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

export async function sendTaskQuiz(request: Request, taskId: string) {
  const { user, response } = await signedIn(request, taskId);
  if (!user) return response;
  try {
    const body = await readLimitedJson(request);
    const result = await submitQuiz(user, taskId, body.answers);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("notFound" in result || "forbidden" in result) return failure("Задание недоступно.", 403);
    if ("validationError" in result) return failure(result.validationError || "Проверьте ответы.", 400);
    if ("error" in result) return failure("Не удалось отправить ответы. Попробуйте ещё раз.", 503);
    // Mentors were queued for a "new work" message by the database; deliver it now.
    scheduleTelegramDelivery();
    return ok({ submission: result.data.submission, score: result.data.score, total: result.data.total }, 201);
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

export async function readTaskVideoViews(request: Request, taskId: string) {
  const { user, response } = await signedIn(request, taskId);
  if (!user) return response;
  const result = await taskVideoViews(user, taskId);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("forbidden" in result) return failure("Недостаточно прав.", 403);
  if ("error" in result) return failure("Не удалось загрузить просмотры.", 503);
  return ok({ views: result.data });
}
