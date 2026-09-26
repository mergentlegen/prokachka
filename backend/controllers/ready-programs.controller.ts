import { failure, ok } from "@/backend/http/api-response";
import { getCurrentUser as currentUser } from "@/backend/http/current-user";
import { isUuid } from "@/backend/http/security";
import { findReadyProgramPublications, publishReadyProgram } from "@/backend/services/programs.service";
import { READY_PROGRAMS, readyProgramByKey } from "@/shared/domain/ready-programs";
import type { ReadyProgramKey } from "@/shared/domain/types";

function canMentor(user: Awaited<ReturnType<typeof currentUser>>) {
  return Boolean(user && (user.role === "ceo" || user.role === "admin" || user.canReview || user.canPublishTasks));
}

function canPublish(user: Awaited<ReturnType<typeof currentUser>>) {
  return Boolean(user && (user.role === "ceo" || user.role === "admin" || user.canPublishTasks));
}

export async function listReadyPrograms(request: Request) {
  const user = await currentUser(request);
  if (!user || !canMentor(user)) return failure("Недостаточно прав.", user ? 403 : 401);
  if (user.role !== "ceo" && !user.teamId) return ok({ readyPrograms: READY_PROGRAMS.map(({ tasks: _tasks, ...program }) => ({ ...program, published: false })) });
  const result = await findReadyProgramPublications(user.role === "ceo" ? "" : user.teamId || "", user.role === "member" ? user.id : null);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось загрузить готовые программы.");
  const published = new Map(result.data.map((row) => [String(row.template_key), row]));
  return ok({ readyPrograms: READY_PROGRAMS.map(({ tasks: _tasks, ...program }) => {
    const row = published.get(program.key);
    return { ...program, published: Boolean(row), publishedProgramId: row ? String(row.id) : undefined, publishedActive: row ? Boolean(row.is_active) : undefined, publishedPinned: row ? Boolean(row.is_pinned) : false, publishedCreatedAt: row ? String(row.created_at) : undefined,
      canManage: Boolean(row && canPublish(user) && (user.role === "admin" || user.role === "ceo" || row.publisher_id === user.id)) };
  }) });
}

export async function postReadyProgram(request: Request) {
  const user = await currentUser(request);
  if (!user || !canPublish(user)) return failure("Недостаточно прав.", user ? 403 : 401);
  if (user.role !== "ceo" && !user.teamId) return failure("За пользователем не закреплена команда.", 403);
  try {
    const body = await request.json();
    const key = body?.key as ReadyProgramKey;
    if (!readyProgramByKey(key)) return failure("Готовая программа не найдена.", 404);
    const teamId = user.role === "ceo" ? typeof body?.teamId === "string" ? body.teamId : "" : user.teamId || "";
    if (!isUuid(teamId)) return failure("Программа должна быть привязана к команде.", 400);
    const result = await publishReadyProgram({
      teamId,
      key,
      publisherId: user.role === "ceo" ? undefined : user.id,
      audienceRootId: user.role === "member" ? user.id : null,
    });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("validationError" in result) return failure(result.validationError || "Готовая программа не найдена.", 400);
    if ("error" in result) return failure("Не удалось опубликовать готовую программу.");
    return ok({ program: result.data.program, tasks: result.data.tasks, alreadyPublished: "alreadyPublished" in result && result.alreadyPublished }, "alreadyPublished" in result && result.alreadyPublished ? 200 : 201);
  } catch { return failure("Некорректные данные.", 400); }
}
