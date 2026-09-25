import { failure, ok } from "@/backend/http/api-response";
import { getCurrentUser as currentUser } from "@/backend/http/current-user";
import { isUuid } from "@/backend/http/security";
import { advanceReadyProgramAttempt, answerReadyProgramAttempt, completeReadyProgramAttempt, restartReadyProgramQuizAttempt, startReadyProgramAttempt, type ReadyAttemptAction } from "@/backend/services/ready-programs.service";

function resultResponse(result: Awaited<ReturnType<typeof startReadyProgramAttempt>>) {
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("validationError" in result) return failure(result.validationError, 409);
  if ("error" in result) return failure("Не удалось сохранить прогресс готовой программы.");
  return ok({ attempt: result.data });
}

export async function postReadyProgramAttempt(request: Request, taskId: string) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role !== "member") return failure("Готовую программу может проходить только участник.", 403);
  if (!isUuid(taskId)) return failure("Некорректное интерактивное задание.", 400);
  try {
    const body = await request.json() as { action?: ReadyAttemptAction; step?: unknown; answer?: unknown; restart?: unknown };
    const action = body?.action;
    if (action !== "start" && action !== "advance" && action !== "answer" && action !== "restart-quiz" && action !== "complete") return failure("Неизвестное действие программы.", 400);
    if (action === "start") {
      if (body.restart !== undefined && typeof body.restart !== "boolean") return failure("Некорректный режим запуска.", 400);
      return resultResponse(await startReadyProgramAttempt(user.id, taskId, body.restart === true));
    }
    if (action === "advance") {
      if (!Number.isInteger(body.step) || Number(body.step) < 1 || Number(body.step) > 12) return failure("Некорректный шаг программы.", 400);
      return resultResponse(await advanceReadyProgramAttempt(user.id, taskId, Number(body.step)));
    }
    if (action === "answer") {
      if (!Number.isInteger(body.answer) || Number(body.answer) < 0 || Number(body.answer) > 2) return failure("Некорректный ответ программы.", 400);
      return resultResponse(await answerReadyProgramAttempt(user.id, taskId, Number(body.answer)));
    }
    if (action === "restart-quiz") return resultResponse(await restartReadyProgramQuizAttempt(user.id, taskId));
    return resultResponse(await completeReadyProgramAttempt(user.id, taskId));
  } catch { return failure("Некорректные данные.", 400); }
}
