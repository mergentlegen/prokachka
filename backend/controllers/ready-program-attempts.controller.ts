import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { databaseFailure, failure, ok } from "@/backend/http/api-response";
import { getCurrentUser as currentUser } from "@/backend/http/current-user";
import { isUuid } from "@/backend/http/security";
import { prepareCompanyVoice } from "@/backend/services/telegram-submission.service";
import { captainCruiseAction, type CaptainAction } from "@/backend/services/captain-cruise.service";
import { countYourDreamAction } from "@/backend/services/count-your-dream.service";
import { dreamRouteAction } from "@/backend/services/dream-route.service";
import { firstYearAction } from "@/backend/services/first-year.service";
import { safetyWatchAction, type SafetyWatchOperation } from "@/backend/services/safety-watch.service";
import { participationRulesAction } from "@/backend/services/participation-rules.service";
import { finalVoyageAction, type FinalVoyageOperation } from "@/backend/services/final-voyage.service";
import { FINAL_VOYAGE_DREAM_LIMIT, FINAL_VOYAGE_STEPS } from "@/shared/domain/final-voyage";
import { objectionTrainerAction, type TrainerKind, type TrainerOperation } from "@/backend/services/objection-trainer.service";
import { PODUMAYU_TRAINER } from "@/shared/domain/podumayu";
import { DOROGO_TRAINER } from "@/shared/domain/dorogo";
import { PIRAMIDA_TRAINER } from "@/shared/domain/piramida";
import { GARANTII_TRAINER } from "@/shared/domain/garantii";
import { BALLY_TRAINER } from "@/shared/domain/bally";
import { DESHEVLE_TRAINER } from "@/shared/domain/deshevle";
import { STRAH_TRAINER } from "@/shared/domain/strah";
import { VREMYA_TRAINER } from "@/shared/domain/vremya";
import { SEMYA_TRAINER } from "@/shared/domain/semya";
import { SETEVOY_TRAINER } from "@/shared/domain/setevoy";
import { CABINET_TRAINERS, cabinetTrainerAction, isCabinetTrainerKind, type CabinetTrainerOperation } from "@/backend/services/cabinet-trainer.service";
import { advanceReadyProgramAttempt, answerReadyProgramAttempt, completeReadyProgramAttempt, restartReadyProgramQuizAttempt, saveCompanyStory, startReadyProgramAttempt, type ReadyAttemptAction } from "@/backend/services/ready-programs.service";

function resultResponse(result: Awaited<ReturnType<typeof startReadyProgramAttempt>>) {
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("validationError" in result) return failure(result.validationError, 409);
  if ("error" in result) return databaseFailure(result.error, "Не удалось сохранить прогресс готовой программы.");
  return ok({ attempt: result.data });
}

export async function postReadyProgramAttempt(request: Request, taskId: string) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role !== "member") return failure("Готовую программу может проходить только участник.", 403);
  if (!isUuid(taskId)) return failure("Некорректное интерактивное задание.", 400);
  try {
    const body = await readLimitedJson(request) as { action?: ReadyAttemptAction | "captain" | "count-dream" | "dream-route" | "first-year" | "safety-watch" | "free-membership" | "marketing-director" | "participation-rules" | "final-voyage" | TrainerKind; step?: unknown; question?: unknown; answer?: unknown; restart?: unknown; questionIndex?: unknown; choices?: unknown; operation?: CaptainAction | "save" | "complete" | "answer" | "dream" | "mark"; index?: unknown; payload?: unknown };
    const action = body?.action;
    if (isCabinetTrainerKind(action)) {
      // A cabinet trainer: its own number of missions and questions of the check.
      const limits = CABINET_TRAINERS[action];
      const logKey = new RegExp(`^(m[1-${limits.missions}]|q[1-${limits.questions}])$`);
      const payload = body.payload as { answer?: unknown; answers?: unknown; errors?: unknown; hints?: unknown; log?: unknown } | undefined;
      const small = (value: unknown) => value === undefined || (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 999);
      if (!body.operation || !["start", "save", "complete"].includes(body.operation)
        || (body.step !== undefined && (!Number.isInteger(body.step) || Number(body.step) < 0 || Number(body.step) > limits.missions))
        || (payload !== undefined && (!payload || typeof payload !== "object" || Array.isArray(payload)))
        || (payload?.answer !== undefined && (!Number.isInteger(payload.answer) || Number(payload.answer) < 0 || Number(payload.answer) > 2))
        || (payload?.answers !== undefined && (!Array.isArray(payload.answers) || payload.answers.length > limits.questions || !payload.answers.every((value) => Number.isInteger(value) && value >= 0 && value <= 2)))
        || !small(payload?.errors) || !small(payload?.hints)
        || (payload?.log !== undefined && (!payload.log || typeof payload.log !== "object" || Array.isArray(payload.log)
          || !Object.entries(payload.log).every(([key, count]) => logKey.test(key) && small(count))))
        || JSON.stringify(payload || {}).length > 1000) return failure("Некорректные данные тренажёра.", 400);
      const result = await cabinetTrainerAction(action, user.id, taskId, body.operation as CabinetTrainerOperation, Number(body.step || 0), payload as Record<string, unknown> | undefined);
      if ("unavailable" in result) return failure("База данных пока недоступна.", 503);
      if ("validationError" in result) return failure(result.validationError || "Некорректный прогресс тренажёра.", 409);
      if ("error" in result) return databaseFailure(result.error, "Не удалось сохранить тренажёр. Попробуйте ещё раз.");
      return ok({ attempt: result.data });
    }
    if (action === "participation-rules") {
      const pick = (value: unknown, max: number) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max;
      if (body.operation !== "start" && body.operation !== "answer") return failure("Некорректные данные теста.", 400);
      if (body.operation === "answer" && (!pick(body.question, 4) || !pick(body.answer, 2))) return failure("Некорректные данные теста.", 400);
      const result = await participationRulesAction(user.id, taskId, body.operation, Number(body.question || 0), Number(body.answer || 0));
      if ("unavailable" in result) return failure("База данных пока недоступна.", 503);
      if ("validationError" in result) return failure(result.validationError || "Ответ не сохранился.", 409);
      if ("error" in result) return databaseFailure(result.error, "Не удалось сохранить ответ. Попробуйте ещё раз.");
      return ok({ attempt: result.data });
    }
    if (action === "final-voyage") {
      // «Финальный рейс уровня 1»: the current step, an option 0–2 or the three short dream lines.
      const payload = body.payload as { answer?: unknown; what?: unknown; price?: unknown; when?: unknown } | undefined;
      const line = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= FINAL_VOYAGE_DREAM_LIMIT;
      if (!body.operation || !["start", "answer", "dream", "complete"].includes(body.operation)
        || (body.step !== undefined && (!Number.isInteger(body.step) || Number(body.step) < 0 || Number(body.step) >= FINAL_VOYAGE_STEPS.length))
        || (payload !== undefined && (!payload || typeof payload !== "object" || Array.isArray(payload)))
        || (body.operation === "answer" && (!Number.isInteger(payload?.answer) || Number(payload?.answer) < 0 || Number(payload?.answer) > 2))
        || (body.operation === "dream" && (!line(payload?.what) || !line(payload?.price) || !line(payload?.when)))
        || JSON.stringify(payload || {}).length > 1000) return failure("Некорректные данные игры.", 400);
      const result = await finalVoyageAction(user.id, taskId, body.operation as FinalVoyageOperation, Number(body.step || 0), payload as Record<string, unknown> | undefined);
      if ("unavailable" in result) return failure("База данных пока недоступна.", 503);
      if ("validationError" in result) return failure(result.validationError || "Некорректный прогресс игры.", 409);
      if ("error" in result) return databaseFailure(result.error, "Не удалось сохранить игру. Попробуйте ещё раз.");
      return ok({ attempt: result.data });
    }
    if (action === "podumayu" || action === "dorogo" || action === "piramida" || action === "garantii" || action === "bally" || action === "deshevle" || action === "strah" || action === "vremya" || action === "semya" || action === "setevoy") {
      // Objection trainers («Я подумаю», «Дорого», «Это пирамида», «Кто гарантирует?», «Баллы»): the current round, an option 0–3, or a phrase of the sorting round with «помогает» / «вредит».
      const trainer = { podumayu: PODUMAYU_TRAINER, dorogo: DOROGO_TRAINER, piramida: PIRAMIDA_TRAINER, garantii: GARANTII_TRAINER, bally: BALLY_TRAINER, deshevle: DESHEVLE_TRAINER, strah: STRAH_TRAINER, vremya: VREMYA_TRAINER, semya: SEMYA_TRAINER, setevoy: SETEVOY_TRAINER }[action];
      const sort = trainer.rounds[trainer.sortStep];
      const phrases = sort?.kind === "sort" ? sort.phrases.length : 0;
      const payload = body.payload as { answer?: unknown; item?: unknown; good?: unknown } | undefined;
      const index = (value: unknown, count: number) => Number.isInteger(value) && Number(value) >= 0 && Number(value) < count;
      if (!body.operation || !["start", "answer", "mark", "complete"].includes(body.operation)
        || (body.step !== undefined && (!Number.isInteger(body.step) || Number(body.step) < 0 || Number(body.step) >= trainer.rounds.length))
        || (payload !== undefined && (!payload || typeof payload !== "object" || Array.isArray(payload)))
        || (body.operation === "answer" && !index(payload?.answer, 4))
        || (body.operation === "mark" && (!index(payload?.item, phrases) || typeof payload?.good !== "boolean"))
        || JSON.stringify(payload || {}).length > 200) return failure("Некорректные данные тренажёра.", 400);
      const result = await objectionTrainerAction(action, user.id, taskId, body.operation as TrainerOperation, Number(body.step || 0), payload as Record<string, unknown> | undefined);
      if ("unavailable" in result) return failure("База данных пока недоступна.", 503);
      if ("validationError" in result) return failure(result.validationError || "Некорректный прогресс тренажёра.", 409);
      if ("error" in result) return databaseFailure(result.error, "Не удалось сохранить тренажёр. Попробуйте ещё раз.");
      return ok({ attempt: result.data });
    }
    if (action === "safety-watch") {
      const payload = body.payload as { answers?: unknown } | undefined;
      if (!body.operation || !["start", "save", "complete"].includes(body.operation)
        || (body.step !== undefined && (!Number.isInteger(body.step) || Number(body.step) < 0 || Number(body.step) > 4))
        || (payload !== undefined && (!payload || typeof payload !== "object" || Array.isArray(payload)))
        || (payload?.answers !== undefined && (!Array.isArray(payload.answers) || payload.answers.length > 7 || !payload.answers.every((value) => Number.isInteger(value) && value >= 0 && value <= 2)))
        || JSON.stringify(payload || {}).length > 1000) return failure("Некорректные данные игры.", 400);
      const result = await safetyWatchAction(user.id, taskId, body.operation as SafetyWatchOperation, Number(body.step || 0), payload as Record<string, unknown> | undefined);
      if ("unavailable" in result) return failure("База данных пока недоступна.", 503);
      if ("validationError" in result) return failure(result.validationError || "Некорректный прогресс игры.", 409);
      if ("error" in result) return databaseFailure(result.error, "Не удалось сохранить игру. Попробуйте ещё раз.");
      return ok({ attempt: result.data });
    }
    if (action === "first-year") {
      if (!body.operation || !["start", "save", "complete"].includes(body.operation)
        || (body.step !== undefined && (!Number.isInteger(body.step) || Number(body.step) < 0 || Number(body.step) > 12))
        || (body.payload !== undefined && (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)))
        || JSON.stringify(body.payload || {}).length > 2000) return failure("Некорректные данные игры.", 400);
      const result = await firstYearAction(user.id, taskId, body.operation as "start" | "save" | "complete", Number(body.step || 0), body.payload as Record<string, unknown> | undefined);
      if ("unavailable" in result) return failure("База данных пока недоступна.", 503);
      if ("validationError" in result) return failure(result.validationError || "Некорректный прогресс игры.", 409);
      if ("error" in result) return databaseFailure(result.error, "Не удалось сохранить игру. Попробуйте ещё раз.");
      return ok({ attempt: result.data });
    }
    if (action === "dream-route") {
      if (!body.operation || !["start", "save", "complete"].includes(body.operation)
        || (body.step !== undefined && (!Number.isInteger(body.step) || Number(body.step) < 0 || Number(body.step) > 11))
        || (body.payload !== undefined && (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)))
        || JSON.stringify(body.payload || {}).length > 5000) return failure("Некорректные данные маршрута.", 400);
      const result = await dreamRouteAction(user.id, taskId, body.operation as "start" | "save" | "complete", Number(body.step || 0), body.payload as Record<string, unknown> | undefined);
      if ("unavailable" in result) return failure("База данных пока недоступна.", 503);
      if ("validationError" in result) return failure(result.validationError || "Некорректный прогресс маршрута.", 409);
      if ("error" in result) return databaseFailure(result.error, "Не удалось сохранить маршрут. Попробуйте ещё раз.");
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
      if ("error" in result) return databaseFailure(result.error, "Не удалось сохранить прогресс тренажёра. Попробуйте ещё раз.");
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
      if ("error" in result) return databaseFailure(result.error, "Не удалось сохранить тренировку. Попробуйте ещё раз.");
      return "url" in result ? ok({ url: result.url, expiresAt: result.expiresAt }) : ok({ attempt: result.data });
    }
    if (action !== "start" && action !== "advance" && action !== "answer" && action !== "restart-quiz" && action !== "complete" && action !== "save-story" && action !== "voice-link") return failure("Неизвестное действие программы.", 400);
    if (action === "voice-link") {
      const result = await prepareCompanyVoice(user.id, taskId);
      if ("unavailable" in result) return failure("Telegram-бот или база данных пока не настроены.", 503);
      if ("validationError" in result) return failure(result.validationError || "Голосовое сейчас недоступно.", "linkRequired" in result ? 422 : 409);
      if ("error" in result) return databaseFailure(result.error, "Не удалось подготовить отправку голосового.");
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
