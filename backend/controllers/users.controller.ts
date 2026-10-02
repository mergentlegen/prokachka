import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { hasRole } from "@/backend/http/auth-guard";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { deleteUser, findUsers, previewUserDeletion, saveUser, updateUserAccess } from "@/backend/services/users.service";
import { getCurrentUser } from "@/backend/http/current-user";
import { descendants, findTeamNetwork } from "@/backend/services/network.service";
import { scheduleTelegramDelivery } from "@/backend/services/telegram-notifications.service";
import { withAvatarUrls } from "@/backend/services/avatar-urls.service";
import { auditRecord, auditUser, recordAudit } from "@/backend/services/audit-log.service";

export async function listUsers(request: Request) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) return failure("Сначала войдите в аккаунт.", 401);
  if (currentUser.role === "admin" && !currentUser.teamId) return ok({ users: [] });
  if (currentUser.role === "member" && currentUser.teamId) {
    const network = await findTeamNetwork(currentUser.teamId);
    if ("unavailable" in network) return failure("База данных не настроена.", 503);
    if ("error" in network) return failure("Не удалось загрузить участников.");
    const allowed = descendants(network.data, currentUser.id, true);
    return ok({ users: await withAvatarUrls(network.data.filter((row) => allowed.has(String(row.id)))) });
  }
  const result = await findUsers({
    teamId: currentUser.role === "ceo" ? undefined : currentUser.teamId,
    userId: currentUser.role === "member" ? currentUser.id : undefined,
    includeLogin: currentUser.role === "ceo" || currentUser.role === "member",
  });
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось загрузить участников.");
  return ok({ users: await withAvatarUrls(result.data || []) });
}

export async function upsertUser(request: Request) {
  const currentUser = await getCurrentUser(request);
  if (!hasRole(currentUser, ["ceo"])) return failure("Недостаточно прав.", currentUser ? 403 : 401);
  try {
    const body = await readLimitedJson(request);
    if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 160
      || !/^[1-9][0-9]{0,15}$/.test(String(body.telegramId))) return failure("Укажите имя (2–160 символов) и корректный Telegram ID.", 400);
    const result = await saveUser(body.name.trim(), String(body.telegramId));
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure("Не удалось сохранить участника.");
    return ok({ user: (await withAvatarUrls([result.data]))[0] }, 201);
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}
export async function updateUserAccessController(request: Request, id: string) {
  const currentUser = await getCurrentUser(request);
  if (!isUuid(id)) return failure("Некорректный пользователь.", 400);
  if (!currentUser || currentUser.role !== "ceo") return failure("Недостаточно прав.", currentUser ? 403 : 401);
  try {
    const body = await readLimitedJson(request);
    if (body.role !== "admin" && body.role !== "member") return failure("Можно назначить только участника или наставника.", 400);
    if (body.teamId !== undefined && body.teamId !== null && body.teamId !== "" && !isUuid(body.teamId)) return failure("Некорректная команда.", 400);
    const before = await auditUser(id);
    const result = await updateUserAccess(id, { role: body.role, teamId: body.teamId });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure(result.error.code === "23514"
      ? "Не удалось изменить команду. Сначала переподчините участников нижней ветки и проверьте выбранную команду."
      : "Не удалось обновить доступ пользователя.", result.error.code === "23514" ? 409 : 500);
    scheduleTelegramDelivery();
    const nextTeamId = body.teamId ? String(body.teamId) : null;
    const details: Record<string, unknown> = {};
    if (before && before.role !== body.role) details.role = [before.role, body.role];
    if (before && before.teamId !== nextTeamId) details.team = [before.teamId ? (await auditRecord("teams", before.teamId))?.label || null : null, nextTeamId ? (await auditRecord("teams", nextTeamId))?.label || null : null];
    if (!before || Object.keys(details).length) await recordAudit(currentUser, { action: "user.access", targetId: id, targetLabel: before?.name || String(result.data?.name || ""), teamId: nextTeamId || before?.teamId, details });
    return ok({ user: (await withAvatarUrls([result.data]))[0] });
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

export async function previewUserDeletionController(request: Request, id: string) {
  const currentUser = await getCurrentUser(request);
  if (!isUuid(id)) return failure("Некорректный пользователь.", 400);
  if (!currentUser || currentUser.role !== "ceo") return failure("Недостаточно прав.", currentUser ? 403 : 401);
  const result = await previewUserDeletion(id);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось проверить связанные данные пользователя.", 500);
  if (result.data?.notFound) return failure("Пользователь уже удалён.", 404);
  if (result.data?.forbidden) return failure("Нельзя удалить учётную запись CEO.", 403);
  return ok({ impact: result.data?.impact });
}

export async function deleteUserController(request: Request, id: string) {
  const currentUser = await getCurrentUser(request);
  if (!isUuid(id)) return failure("Некорректный пользователь.", 400);
  if (!currentUser || currentUser.role !== "ceo") return failure("Недостаточно прав.", currentUser ? 403 : 401);
  const before = await auditUser(id);
  const result = await deleteUser(id);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure(result.error.code === "23503"
    ? "Удаление остановлено базой: остались связанные данные. Ничего не удалено; обратитесь к администратору."
    : "Не удалось удалить пользователя. Ничего не удалено.", result.error.code === "23503" ? 409 : 500);
  if (result.data?.notFound) return failure("Пользователь уже удалён. Обновите список.", 404);
  if (result.data?.forbidden) return failure("Нельзя удалить учётную запись CEO.", 403);
  await recordAudit(currentUser, { action: "user.delete", targetId: id, targetLabel: before?.name, details: before ? { role: before.role } : {} });
  return ok({ cleanupPending: result.data?.cleanupPending === true });
}
