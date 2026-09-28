import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { failure, ok } from "@/backend/http/api-response";
import { getCurrentUser as currentUser } from "@/backend/http/current-user";
import { isUuid } from "@/backend/http/security";
import { prepareCompanyVoice } from "@/backend/services/telegram-submission.service";
import { captainCruiseAction, type CaptainAction } from "@/backend/services/captain-cruise.service";
import { countYourDreamAction } from "@/backend/services/count-your-dream.service";
import { orgEnvironmentAction, type OrgAction } from "@/backend/services/org-environment.service";
import { advanceReadyProgramAttempt, answerReadyProgramAttempt, completeReadyProgramAttempt, restartReadyProgramQuizAttempt, saveCompanyStory, startReadyProgramAttempt, type ReadyAttemptAction } from "@/backend/services/ready-programs.service";

function resultResponse(result: Awaited<ReturnType<typeof startReadyProgramAttempt>>) {
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("validationError" in result) return failure(result.validationError, 409);
  if ("error" in result) return failure("Не удалось сохранить прогресс готовой программы.");
  return ok({ attempt: result.data });
}

function validOrgTranscript(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.quiz) || data.quiz.length !== 10 || !Array.isArray(data.sort) || data.sort.length !== 15
    || !Array.isArray(data.blitz) || data.blitz.length > 100) return false;
  return data.quiz.every((move: unknown) => validOrgMove(move, 14, 3, 20000, true))
    && data.sort.every((move: unknown) => validOrgMove(move, 15, 2, 3600000, false))
    && data.blitz.every((move: unknown) => validOrgMove(move, 20, 1, 44999, false, "atMs"));
}

function validOrgMove(value: unknown, ids: number, choices: number, maxMs: number, nullable: boolean, timeKey = "ms") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const move = value as Record<string, unknown>;
  return Number.isInteger(move.id) && Number(move.id) >= 0 && Number(move.id) < ids
    && Number.isInteger(move[timeKey]) && Number(move[timeKey]) >= 0 && Number(move[timeKey]) <= maxMs
    && (nullable && move.answer === null || Number.isInteger(move.answer) && Number(move.answer) >= 0 && Number(move.answer) <= choices);
}

export async function postReadyProgramAttempt(request: Request, taskId: string) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role !== "member") return failure("Готовую программу может проходить только участник.", 403);
  if (!isUuid(taskId)) return failure("Некорректное интерактивное задание.", 400);
  try {
    const body = await readLimitedJson(request) as { action?: ReadyAttemptAction | "captain" | "count-dream" | "org-environment"; step?: unknown; answer?: unknown; restart?: unknown; questionIndex?: unknown; choices?: unknown; operation?: CaptainAction | OrgAction | "save" | "complete"; index?: unknown; payload?: unknown };
    const action = body?.action;
    if (action === "org-environment") {
      if ((body.operation !== "start" && body.operation !== "finish")
        || (body.operation === "finish" && !validOrgTranscript(body.payload))) return failure("Некорректное действие игры.", 400);
      const result = await orgEnvironmentAction(user.id, taskId, body.operation as OrgAction, body.payload);
      if ("unavailable" in result) return failure("База данных пока недоступна.", 503);
      if ("validationError" in result) return failure(result.validationError || "Некорректное действие игры.", 409);
      if ("error" in result) return failure("Не удалось сохранить ход игры. Попробуйте ещё раз.");
      return ok({ attempt: result.data });
    }
    if (action === "count-dream") {
      if (!body.operation || !["start", "save", "complete"].includes(body.operation)
        || (body.step !== undefined && (!Number.isInteger(body.step) || Number(body.step) < 0 || Number(body.step) > 12))
        || (body.payload !== undefined && (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)))
        || JSON.stringify(body.payload || {}).length > 8000) return failure("Некорректные данные тренажёра.", 400);
      const result = await countYourDreamAction(user.id, taskId, body.operation as "start" | "save" | "complete", Number(body.step || 0), body.payload as Record<string, unknown> | undefined);
      if ("unavailable" in result) return failure("База данных пока недоступна.", 503);
      if ("validationError" in result) return failure(result.validationError || "Некорректные ответы тренажёра.", 409);
      if ("error" in result) return failure("Не удалось сохранить прогресс тренажёра. Попробуйте ещё раз.");
      return ok({ attempt: result.data });
    }
    if (action === "captain") {
      if (!body.operation || !["start", "checkpoint", "retry", "finish", "save-details", "telegram-link"].includes(body.operation)
        || (body.index !== undefined && (!Number.isInteger(body.index) || Number(body.index) < 0 || Number(body.index) > 15))
        || (body.payload !== undefined && (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)))
        || JSON.stringify(body.payload || {}).length > 3000) return failure("Некорректное действие тренировки.", 400);
      const result = await captainCruiseAction(user.id, taskId, body.operation as CaptainAction, body.index as number | undefined, body.payload as Record<string, unknown> | undefined);
      if ("unavailable" in result) return failure("База данных или Telegram пока не настроены.", 503);
      if ("validationError" in result) return failure(result.validationError || "Отправка пока недоступна.", "linkRequired" in result ? 422 : 409);
      if ("error" in result) return failure("Не удалось сохранить тренировку. Попробуйте ещё раз.");
      return "url" in result ? ok({ url: result.url, expiresAt: result.expiresAt }) : ok({ attempt: result.data });
    }
    if (action !== "start" && action !== "advance" && action !== "answer" && action !== "restart-quiz" && action !== "complete" && action !== "save-story" && action !== "voice-link") return failure("Неизвестное действие программы.", 400);
    if (action === "voice-link") {
      const result = await prepareCompanyVoice(user.id, taskId);
      if ("unavailable" in result) return failure("Telegram-бот или база данных пока не настроены.", 503);
      if ("validationError" in result) return failure(result.validationError || "Голосовое сейчас недоступно.", "linkRequired" in result ? 422 : 409);
      if ("error" in result) return failure("Не удалось подготовить отправку голосового.");
      return ok({ url: result.url, expiresAt: result.expiresAt });
    }
    if (action === "save-story") {
      if (!Array.isArray(body.choices) || body.choices.length !== 3 || body.choices.some((choice) => !Number.isInteger(choice) || choice < 0 || choice > 4)) return failure("Выберите по одной фразе в каждой части рассказа.", 400);
      return resultResponse(await saveCompanyStory(user.id, taskId, body.choices));
    }
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
      if (body.questionIndex !== undefined && (!Number.isInteger(body.questionIndex) || Number(body.questionIndex) < 0 || Number(body.questionIndex) > 99)) return failure("Некорректный вопрос программы.", 400);
      return resultResponse(await answerReadyProgramAttempt(user.id, taskId, Number(body.answer), body.questionIndex === undefined ? undefined : Number(body.questionIndex)));
    }
    if (action === "restart-quiz") return resultResponse(await restartReadyProgramQuizAttempt(user.id, taskId));
    return resultResponse(await completeReadyProgramAttempt(user.id, taskId));
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}
