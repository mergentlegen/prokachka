import { getRequestUser, hasRole } from "@/backend/http/auth-guard";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { createTeam, findTeams, removeTeam, updateTeam } from "@/backend/services/teams.service";

export async function listTeams(request: Request) {
  const user = getRequestUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const result = await findTeams(user.role === "ceo");
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось загрузить команды.");
  return ok({ teams: result.data });
}

export async function createTeamController(request: Request) {
  const user = getRequestUser(request);
  if (!hasRole(user, ["ceo"])) return failure("Недостаточно прав.", user ? 403 : 401);
  try {
    const body = await request.json();
    if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 100) return failure("Название команды должно быть от 2 до 100 символов.", 400);
    if (typeof body.description === "string" && body.description.length > 1000) return failure("Описание команды слишком длинное.", 400);
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") return failure("Некорректный статус команды.", 400);
    const result = await createTeam({ name: body.name, description: typeof body.description === "string" ? body.description : "", isActive: body.isActive });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure("Не удалось создать команду.");
    return ok({ team: result.data }, 201);
  } catch { return failure("Некорректные данные.", 400); }
}

export async function updateTeamController(request: Request, id: string) {
  const user = getRequestUser(request);
  if (!isUuid(id)) return failure("Некорректная команда.", 400);
  if (!hasRole(user, ["ceo"])) return failure("Недостаточно прав.", user ? 403 : 401);
  try {
    const body = await request.json();
    if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 100)) return failure("Название команды должно быть от 2 до 100 символов.", 400);
    if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 1000)) return failure("Описание команды слишком длинное.", 400);
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") return failure("Некорректный статус команды.", 400);
    const result = await updateTeam(id, body);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure("Не удалось изменить команду.");
    return ok({ team: result.data });
  } catch { return failure("Некорректные данные.", 400); }
}

export async function deleteTeamController(request: Request, id: string) {
  const user = getRequestUser(request);
  if (!isUuid(id)) return failure("Некорректная команда.", 400);
  if (!hasRole(user, ["ceo"])) return failure("Недостаточно прав.", user ? 403 : 401);
  const result = await removeTeam(id);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось деактивировать команду.");
  return ok({});
}