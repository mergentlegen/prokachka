import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { getCurrentUser as currentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { createJoinRequest, findJoinRequests, findReviewableJoinRequests, reviewJoinRequest } from "@/backend/services/team-requests.service";
import { auditPersonRecord, recordAudit } from "@/backend/services/audit-log.service";


export async function listTeamRequests(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if ((user.role === "admin" || user.canReview) && user.role !== "ceo" && !user.teamId) return ok({ requests: [] });
  const result = user.role === "member" && user.canReview
    ? await findReviewableJoinRequests(user.id)
    : await findJoinRequests(user.role === "ceo" ? {} : user.role === "admin" ? { teamId: user.teamId } : { userId: user.id });
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось загрузить заявки.");
  return ok({ requests: result.data });
}

export async function createTeamRequest(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role !== "member") return failure("Заявка доступна только участнику.", 403);
  try {
    const body = await readLimitedJson(request);
    if (!isUuid(body.teamId)) return failure("Некорректная команда.", 400);
    const inviteToken = body.inviteToken === undefined ? undefined : String(body.inviteToken);
    if (inviteToken && (inviteToken.length < 20 || inviteToken.length > 128 || !/^[A-Za-z0-9_-]+$/.test(inviteToken))) return failure("Некорректная ссылка приглашения.", 400);
    const result = await createJoinRequest(user.id, body.teamId, inviteToken);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("validationError" in result) return failure(result.validationError || "Заявка не может быть обработана.", 400);
    if (result.error) return failure("Не удалось отправить заявку.");
    return ok({ request: result.data }, 201);
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

export async function reviewTeamRequest(request: Request, id: string) {
  const user = await currentUser(request);
  if (!user || (user.role !== "ceo" && user.role !== "admin" && !(user.role === "member" && user.canReview))) return failure("Недостаточно прав.", user ? 403 : 401);
  if (user.role !== "ceo" && !user.teamId) return failure("За наставником не закреплена команда.", 403);
  try {
    const body = await readLimitedJson(request);
    if (!isUuid(id)) return failure("Некорректная заявка.", 400);
    const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
    if (!status) return failure("Неизвестный статус заявки.", 400);
    const result = await reviewJoinRequest(id, status, user);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("Заявка не относится к вашей ветке или команде.", 403);
    if ("validationError" in result) return failure(result.validationError || "Заявка не может быть обработана.", 400);
    if ("error" in result) return failure("Не удалось обработать заявку.");
    const reviewed = await auditPersonRecord("team_join_requests", id);
    await recordAudit(user, { action: status === "approved" ? "request.approve" : "request.reject", targetId: id, targetLabel: reviewed?.label, teamId: reviewed?.teamId });
    return ok({ request: result.data });
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}
