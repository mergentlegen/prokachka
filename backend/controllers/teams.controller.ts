import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { hasRole } from "@/backend/http/auth-guard";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { createTeam, deleteTeam, findTeams, removeTeam, updateTeam } from "@/backend/services/teams.service";
import { getCurrentUser } from "@/backend/http/current-user";
import { auditRecord, recordAudit } from "@/backend/services/audit-log.service";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

async function teamState(id: string) {
  const result = await getSupabaseAdmin()?.from("teams").select("name,description,is_active").eq("id", id).maybeSingle();
  return result?.data ? { name: String(result.data.name), description: String(result.data.description || ""), isActive: Boolean(result.data.is_active) } : null;
}

export async function listTeams(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const result = await findTeams(user.role === "ceo");
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось загрузить команды.");
  return ok({ teams: result.data });
}

export async function createTeamController(request: Request) {
  const user = await getCurrentUser(request);
  if (!hasRole(user, ["ceo"])) return failure("Недостаточно прав.", user ? 403 : 401);
  try {
    const body = await readLimitedJson(request);
    if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 100) return failure("Название команды должно быть от 2 до 100 символов.", 400);
    if (typeof body.description === "string" && body.description.length > 1000) return failure("Описание команды слишком длинное.", 400);
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") return failure("Некорректный статус команды.", 400);
    const result = await createTeam({ name: body.name, description: typeof body.description === "string" ? body.description : "", isActive: body.isActive });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure("Не удалось создать команду.");
    if (user) await recordAudit(user, { action: "team.create", targetId: String(result.data?.id || ""), targetLabel: body.name.trim(), teamId: result.data?.id ? String(result.data.id) : null });
    return ok({ team: result.data }, 201);
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

export async function updateTeamController(request: Request, id: string) {
  const user = await getCurrentUser(request);
  if (!isUuid(id)) return failure("Некорректная команда.", 400);
  if (!hasRole(user, ["ceo"])) return failure("Недостаточно прав.", user ? 403 : 401);
  try {
    const body = await readLimitedJson(request);
    if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 100)) return failure("Название команды должно быть от 2 до 100 символов.", 400);
    if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 1000)) return failure("Описание команды слишком длинное.", 400);
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") return failure("Некорректный статус команды.", 400);
    const before = await teamState(id).catch(() => null);
    const result = await updateTeam(id, body);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure("Не удалось изменить команду.");
    if (user && before) {
      const name = typeof body.name === "string" ? body.name.trim() : before.name;
      if (name !== before.name || (typeof body.description === "string" && body.description.trim() !== before.description.trim())) await recordAudit(user, { action: "team.update", targetId: id, targetLabel: name, teamId: id, details: name !== before.name ? { name: [before.name, name] } : {} });
      if (typeof body.isActive === "boolean" && body.isActive !== before.isActive) await recordAudit(user, { action: body.isActive ? "team.enable" : "team.disable", targetId: id, targetLabel: name, teamId: id });
    }
    return ok({ team: result.data });
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

export async function deleteTeamController(request: Request, id: string) {
  const user = await getCurrentUser(request);
  if (!isUuid(id)) return failure("Некорректная команда.", 400);
  if (!hasRole(user, ["ceo"])) return failure("Недостаточно прав.", user ? 403 : 401);
  const before = await teamState(id).catch(() => null);
  const result = await removeTeam(id);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось деактивировать команду.");
  if (user && before?.isActive) await recordAudit(user, { action: "team.disable", targetId: id, targetLabel: before.name, teamId: id });
  return ok({});
}

export async function permanentlyDeleteTeamController(request: Request, id: string) {
  const user = await getCurrentUser(request);
  if (!isUuid(id)) return failure("Некорректная команда.", 400);
  if (!hasRole(user, ["ceo"])) return failure("Недостаточно прав.", user ? 403 : 401);
  const before = await auditRecord("teams", id);
  const result = await deleteTeam(id);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось удалить команду.");
  if (user) await recordAudit(user, { action: "team.delete", targetId: id, targetLabel: before?.label });
  return ok({});
}
