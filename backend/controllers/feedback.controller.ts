import { getCurrentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { isUuid } from "@/backend/http/security";
import { countFeedback, getFeedback, listFeedback, listFeedbackForTask, listFeedbackTaskGroups, markFeedbackRead, sendFeedback, type FeedbackScope } from "@/backend/services/feedback.service";
import type { AuthUser } from "@/shared/domain/types";
import { scheduleTelegramDelivery } from "@/backend/services/telegram-notifications.service";

const unavailable = () => failure("Обратная связь пока недоступна. Попробуйте позже.", 503);
const denied = () => failure("Переписка недоступна для вашей ветки.", 403);
function scopeFor(request: Request, user: AuthUser): FeedbackScope | null {
  const scope = new URL(request.url).searchParams.get("scope") || "personal";
  if (scope === "personal") return scope;
  return scope === "mentor" && (user.role === "admin" || user.role === "ceo" || user.canReview) ? scope : null;
}

export async function feedbackList(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Войдите в аккаунт.", 401);
  const scope = scopeFor(request, user);
  if (!scope) return denied();
  const params = new URL(request.url).searchParams;
  if (params.get("summary") === "1") {
    const summary = await countFeedback(user, scope);
    if ("unavailable" in summary || "error" in summary) return unavailable();
    return ok({ counts: summary.data });
  }
  const offset = Number(params.get("offset") || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return failure("Некорректная страница.", 400);
  const taskKey = params.get("taskKey");
  if (taskKey && !isUuid(taskKey)) return failure("Некорректное задание.", 400);
  const view = params.get("view");
  if (view && view !== "tasks") return failure("Некорректный вид списка.", 400);
  if ((view || taskKey) && scope !== "mentor") return denied();
  const onlyReply = params.get("filter") === "reply";
  const result = view === "tasks" ? await listFeedbackTaskGroups(user, offset, onlyReply)
    : taskKey ? await listFeedbackForTask(user, taskKey, offset, onlyReply)
      : await listFeedback(user, scope, offset, onlyReply);
  if ("unavailable" in result || "error" in result) return unavailable();
  return ok(view === "tasks" ? { groups: result.data } : { threads: result.data });
}

export async function feedbackDetail(request: Request, id: string) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Войдите в аккаунт.", 401);
  const scope = scopeFor(request, user);
  if (!scope) return denied();
  if (!isUuid(id)) return failure("Некорректная переписка.", 400);
  const result = await getFeedback(id, user, scope);
  if ("unavailable" in result || "error" in result) return unavailable();
  if (!result.data || typeof result.data !== "object" || "forbidden" in result.data) return denied();
  return ok({ thread: result.data });
}

export async function feedbackMessage(request: Request, id: string) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Войдите в аккаунт.", 401);
  const scope = scopeFor(request, user);
  if (!scope) return denied();
  if (!isUuid(id)) return failure("Некорректная переписка.", 400);
  try {
    const input = await readLimitedJson(request);
    if (typeof input.body !== "string" || !input.body.trim() || input.body.trim().length > 4000 || !isUuid(input.nonce)) {
      return failure("Введите сообщение до 4000 символов.", 400);
    }
    const result = await sendFeedback(id, user, scope, input.body, input.nonce);
    if ("unavailable" in result || "error" in result) return unavailable();
    if (!result.data || typeof result.data !== "object") return unavailable();
    if ("forbidden" in result.data) return denied();
    if ("validationError" in result.data) return failure(String(result.data.validationError), 400);
    scheduleTelegramDelivery();
    return ok({ event: result.data });
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

export async function feedbackRead(request: Request, id: string) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Войдите в аккаунт.", 401);
  const scope = scopeFor(request, user);
  if (!scope) return denied();
  if (!isUuid(id)) return failure("Некорректная переписка.", 400);
  const result = await markFeedbackRead(id, user, scope);
  if ("unavailable" in result || "error" in result) return unavailable();
  if (!result.data) return denied();
  return ok({ read: true });
}
