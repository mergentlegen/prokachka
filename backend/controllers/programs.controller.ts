import { getRequestUser, hasRole } from "@/backend/http/auth-guard";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { createProgram, deleteProgram, findPrograms, updateProgram } from "@/backend/services/programs.service";
import { findProgramHistory } from "@/backend/services/program-history.service";

function validText(value: unknown, max: number) { return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= max; }

export async function listPrograms(request: Request) {
  const user = getRequestUser(request);
  if (!user || !hasRole(user, ["ceo", "admin"])) return failure("Недостаточно прав.", user ? 403 : 401);
  if (user.role === "admin" && !user.teamId) return ok({ programs: [] });
  const result = await findPrograms(user.role === "admin" ? user.teamId : undefined);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось загрузить программы.");
  return ok({ programs: result.data });
}

export async function listProgramHistory(request: Request) {
  const user = getRequestUser(request);
  if (!user || !hasRole(user, ["ceo", "admin"])) return failure("Insufficient permissions.", user ? 403 : 401);
  if (user.role === "admin" && !user.teamId) return ok({ programs: [] });
  const result = await findProgramHistory(user.teamId || "");
  if ("unavailable" in result) return failure("Database is not configured.", 503);
  if (result.error) return failure("Could not load program history.");
  return ok({ programs: result.data });
}

export async function postProgram(request: Request) {
  const user = getRequestUser(request);
  if (!user || !hasRole(user, ["ceo", "admin"])) return failure("Недостаточно прав.", user ? 403 : 401);
  try {
    const body = await request.json();
    if (!validText(body.title, 160)) return failure("Укажите название программы.", 400);
    const deadlineHours = Number(body.deadlineHours);
    if (!Number.isInteger(deadlineHours) || deadlineHours < 1 || deadlineHours > 720) return failure("Интервал должен быть от 1 до 720 часов.", 400);
    if (!Array.isArray(body.tasks) || body.tasks.length < 1 || body.tasks.length > 100) return failure("Добавьте от 1 до 100 шагов.", 400);
    const tasks = body.tasks.map((task: Record<string, unknown>) => ({
      title: String(task.title || "").trim(), description: String(task.description || "").trim(),
      maxPoints: Number(task.maxPoints),
    }));
    if (tasks.some((task: { title: string; description: string; maxPoints: number }) => !validText(task.title, 160) || !validText(task.description, 5000) || !Number.isInteger(task.maxPoints) || task.maxPoints < 0 || task.maxPoints > 100)) {
      return failure("Проверьте названия, описания и баллы всех шагов.", 400);
    }
    const teamId = user.role === "admin" ? user.teamId : typeof body.teamId === "string" ? body.teamId : undefined;
    if (!teamId || !isUuid(teamId)) return failure("Программа должна быть привязана к команде.", 400);
    const result = await createProgram({ teamId, title: body.title.trim(), deadlineHours, tasks });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure("Не удалось создать программу.");
    return ok({ program: result.data.program, tasks: result.data.tasks }, 201);
  } catch { return failure("Некорректные данные.", 400); }
}

export async function patchProgram(request: Request, id: string) {
  const user = getRequestUser(request);
  if (!user || !hasRole(user, ["ceo", "admin"])) return failure("Недостаточно прав.", user ? 403 : 401);
  if (!isUuid(id)) return failure("Некорректная программа.", 400);
  try {
    const body = await request.json();
    if (body.title !== undefined && !validText(body.title, 160)) return failure("Некорректное название.", 400);
    if (body.deadlineHours !== undefined && (!Number.isInteger(Number(body.deadlineHours)) || Number(body.deadlineHours) < 1 || Number(body.deadlineHours) > 720)) return failure("Интервал должен быть от 1 до 720 часов.", 400);
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") return failure("Некорректный статус.", 400);
    const result = await updateProgram(id, { title: body.title, deadlineHours: body.deadlineHours === undefined ? undefined : Number(body.deadlineHours), isActive: body.isActive }, user.role === "admin" ? user.teamId : undefined);
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure("Не удалось обновить программу.");
    return ok({ program: result.data });
  } catch { return failure("Некорректные данные.", 400); }
}

export async function deleteProgramController(request: Request, id: string) {
  const user = getRequestUser(request);
  if (!user || !hasRole(user, ["ceo", "admin"])) return failure("Недостаточно прав.", user ? 403 : 401);
  if (!isUuid(id)) return failure("Некорректная программа.", 400);
  if (user.role === "admin" && !user.teamId) return failure("За наставником не закреплена команда.", 403);
  const result = await deleteProgram(id, user.role === "admin" ? user.teamId : undefined);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось удалить программу.");
  return ok({});
}
