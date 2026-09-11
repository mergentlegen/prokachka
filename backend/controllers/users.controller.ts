import { getRequestUser, hasRole } from "@/backend/http/auth-guard";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { deleteUser, findUsers, saveUser, updateUserAccess } from "@/backend/services/users.service";
import { findAccountById } from "@/backend/services/auth.service";
import { descendants, findTeamNetwork } from "@/backend/services/network.service";

export async function listUsers(request: Request) {
  const sessionUser = getRequestUser(request);
  const currentUser = sessionUser?.id === "ceo" ? sessionUser : sessionUser ? (await findAccountById(sessionUser.id)) || (process.env.NEXT_PUBLIC_SUPABASE_URL ? null : sessionUser) : null;
  if (!currentUser) return failure("Сначала войдите в аккаунт.", 401);
  if (currentUser.role === "admin" && !currentUser.teamId) return ok({ users: [] });
  if (currentUser.role === "member" && currentUser.teamId) {
    const network = await findTeamNetwork(currentUser.teamId);
    if ("unavailable" in network) return failure("База данных не настроена.", 503);
    if ("error" in network) return failure("Не удалось загрузить участников.");
    const allowed = descendants(network.data, currentUser.id, true);
    return ok({ users: network.data.filter((row) => allowed.has(String(row.id))) });
  }
  const result = await findUsers({
    teamId: currentUser.role === "ceo" ? undefined : currentUser.teamId,
    userId: currentUser.role === "member" ? currentUser.id : undefined,
    includeLogin: currentUser.role === "ceo" || currentUser.role === "member",
  });
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось загрузить участников.");
  return ok({ users: result.data });
}

export async function upsertUser(request: Request) {
  const currentUser = getRequestUser(request);
  if (!hasRole(currentUser, ["ceo"])) return failure("Недостаточно прав.", currentUser ? 403 : 401);
  try {
    const body = await request.json();
    if (!body.name?.trim() || !body.telegramId) return failure("Нужно имя и Telegram ID.", 400);
    const result = await saveUser(body.name.trim(), String(body.telegramId));
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure("Не удалось сохранить участника.");
    return ok({ user: result.data }, 201);
  } catch { return failure("Некорректные данные.", 400); }
}
export async function updateUserAccessController(request: Request, id: string) {
  const currentUser = getRequestUser(request);
  if (!isUuid(id)) return failure("Некорректный пользователь.", 400);
  if (!currentUser || currentUser.role !== "ceo") return failure("Недостаточно прав.", currentUser ? 403 : 401);
  try {
    const body = await request.json();
    if (body.role !== "admin" && body.role !== "member") return failure("Можно назначить только участника или наставника.", 400);
    if (body.teamId !== undefined && body.teamId !== null && body.teamId !== "" && !isUuid(body.teamId)) return failure("Некорректная команда.", 400);
    const result = await updateUserAccess(id, { role: body.role, teamId: body.teamId });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure("Не удалось обновить доступ пользователя.");
    return ok({ user: result.data });
  } catch { return failure("Некорректные данные.", 400); }
}

export async function deleteUserController(request: Request, id: string) {
  const currentUser = getRequestUser(request);
  if (!isUuid(id)) return failure("Некорректный пользователь.", 400);
  if (!currentUser || currentUser.role !== "ceo") return failure("Недостаточно прав.", currentUser ? 403 : 401);
  const result = await deleteUser(id);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось удалить пользователя.");
  return ok({});
}
