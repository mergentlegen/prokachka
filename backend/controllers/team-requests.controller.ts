import { getRequestUser, hasRole } from "@/backend/http/auth-guard";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { createJoinRequest, findJoinRequests, reviewJoinRequest } from "@/backend/services/team-requests.service";
import { findAccountById } from "@/backend/services/auth.service";

async function currentUser(request: Request) {
  const sessionUser = getRequestUser(request);
  if (!sessionUser) return null;
  if (sessionUser.id === "ceo") return sessionUser;
  return (await findAccountById(sessionUser.id)) || (process.env.NEXT_PUBLIC_SUPABASE_URL ? null : sessionUser);
}

export async function listTeamRequests(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const options = user.role === "ceo" ? {} : user.role === "admin" ? { teamId: user.teamId } : { userId: user.id };
  if (user.role === "admin" && !user.teamId) return ok({ requests: [] });
  const result = await findJoinRequests(options);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось загрузить заявки.");
  return ok({ requests: result.data });
}

export async function createTeamRequest(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role !== "member") return failure("Заявка доступна только участнику.", 403);
  try {
    const body = await request.json();
    if (!isUuid(body.teamId)) return failure("Некорректная команда.", 400);
    const inviteToken = body.inviteToken === undefined ? undefined : String(body.inviteToken);
    if (inviteToken && (inviteToken.length < 20 || inviteToken.length > 128 || !/^[A-Za-z0-9_-]+$/.test(inviteToken))) return failure("Некорректная ссылка приглашения.", 400);
    const result = await createJoinRequest(user.id, body.teamId, inviteToken);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("validationError" in result) return failure(result.validationError || "Заявка не может быть обработана.", 400);
    if (result.error) return failure("Не удалось отправить заявку.");
    return ok({ request: result.data }, 201);
  } catch { return failure("Некорректные данные.", 400); }
}

export async function reviewTeamRequest(request: Request, id: string) {
  const user = await currentUser(request);
  if (!user || !hasRole(user, ["ceo", "admin"])) return failure("Недостаточно прав.", user ? 403 : 401);
  try {
    const body = await request.json();
    if (!isUuid(id)) return failure("Некорректная заявка.", 400);
    const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
    if (!status) return failure("Неизвестный статус заявки.", 400);
    const result = await reviewJoinRequest(id, status, user.id, user.role === "admin" ? user.teamId : undefined);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("Заявка относится к другой команде.", 403);
    if ("validationError" in result) return failure(result.validationError || "Заявка не может быть обработана.", 400);
    if ("error" in result) return failure("Не удалось обработать заявку.");
    return ok({ request: result.data });
  } catch { return failure("Некорректные данные.", 400); }
}
