import { getCurrentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid, parseExternalUrl } from "@/backend/http/security";
import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { auditRecord, recordAudit } from "@/backend/services/audit-log.service";
import { validMiles } from "@/shared/domain/miles";

type RpcResult = { data?: unknown; reopened?: number; forbidden?: boolean; validationError?: string };

async function call(name: string, args: Record<string, unknown>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc(name, args);
  if (result.error) return { error: result.error };
  return { payload: (result.data || {}) as RpcResult };
}

// Adds a ready game as the last step of a program; the database checks who may do it.
export async function addProgramGame(request: Request, programId: string) {
  if (!isUuid(programId)) return failure("Некорректная программа.", 400);
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  try {
    const body = await readLimitedJson(request);
    const result = await call("app_program_add_game", { p_actor: user.id, p_program: programId, p_kind: typeof body.kind === "string" ? body.kind : "" });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("error" in result) return failure("Не удалось добавить игру.", 503);
    if (result.payload.forbidden) return failure("Изменять программу может её автор или руководитель команды.", 403);
    if (result.payload.validationError) return failure(result.payload.validationError, 409);
    const program = await auditRecord("task_programs", programId);
    await recordAudit(user, { action: "task.create", targetId: String((result.payload.data as { id?: string })?.id || ""), targetLabel: "Игра «Мой первый год в клубе»", teamId: program?.teamId, details: { programStep: true, miles: 2 } });
    return ok({ task: result.payload.data, reopened: Number(result.payload.reopened || 0) }, 201);
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

// Adds a normal step to the end of a running program. Participants who had finished the program get it opened.
export async function addProgramStep(request: Request, programId: string) {
  if (!isUuid(programId)) return failure("Некорректная программа.", 400);
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  try {
    const body = await readLimitedJson(request);
    const title = typeof body.title === "string" ? body.title.trim() : "", description = typeof body.description === "string" ? body.description.trim() : "";
    if (title.length < 2 || description.length < 2) return failure("Заполните название и описание.", 400);
    if (title.length > 160 || description.length > 5000) return failure("Название или описание слишком длинные.", 400);
    const resourceUrl = parseExternalUrl(body.resourceUrl);
    if ("error" in resourceUrl) return failure(resourceUrl.error, 400);
    const maxPoints = Number(body.maxPoints ?? 0);
    if (!validMiles(maxPoints)) return failure("Некорректное количество миль.", 400);
    const result = await call("app_program_add_step", { p_actor: user.id, p_program: programId, p_title: title, p_description: description, p_resource_url: resourceUrl.value ?? null, p_max_points: maxPoints });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("error" in result) return failure("Не удалось добавить шаг.", 503);
    if (result.payload.forbidden) return failure("Изменять программу может её автор или руководитель команды.", 403);
    if (result.payload.validationError) return failure(result.payload.validationError, 409);
    const program = await auditRecord("task_programs", programId);
    const reopened = Number(result.payload.reopened || 0);
    await recordAudit(user, { action: "task.create", targetId: String((result.payload.data as { id?: string })?.id || ""), targetLabel: title, teamId: program?.teamId, details: { programStep: true, miles: maxPoints, reopened } });
    return ok({ task: result.payload.data, reopened }, 201);
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}

// Saves a new order of the program's steps; participants keep the step they are on.
export async function reorderProgramSteps(request: Request, programId: string) {
  if (!isUuid(programId)) return failure("Некорректная программа.", 400);
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  try {
    const body = await readLimitedJson(request);
    const ids = Array.isArray(body.taskIds) ? body.taskIds : null;
    if (!ids || ids.length < 1 || ids.length > 100 || !ids.every(isUuid)) return failure("Некорректный порядок шагов.", 400);
    const result = await call("app_program_reorder", { p_actor: user.id, p_program: programId, p_task_ids: ids });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("error" in result) return failure("Не удалось сохранить порядок.", 503);
    if (result.payload.forbidden) return failure("Изменять программу может её автор или руководитель команды.", 403);
    if (result.payload.validationError) return failure(result.payload.validationError, 409);
    return ok({ saved: true });
  } catch (error) { return requestBodyFailure(error) || failure("Некорректные данные.", 400); }
}
