import { readLimitedJson, requestBodyFailure } from "@/backend/http/request-body";
import { getCurrentUser as currentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { findStarAwards, insertStarAward, removeStarAward } from "@/backend/services/stars.service";
import { starAwardOption } from "@/shared/domain/star-awards";
import { auditPersonRecord, recordAudit } from "@/backend/services/audit-log.service";


function isValidComment(value: unknown) {
  return typeof value === "string" && value.trim().length <= 500;
}

export async function listStars(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);

  if (user.role === "member") {
    if (!user.teamId) return ok({ awards: [] });
    const result = await findStarAwards({ teamId: user.teamId, viewer: user });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("error" in result) return failure("Не удалось загрузить звёзды.");
    return ok({ awards: result.data });
  }

  if (user.role === "admin") {
    if (!user.teamId) return ok({ awards: [] });
    const result = await findStarAwards({ teamId: user.teamId });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("error" in result) return failure("Не удалось загрузить звёзды.");
    return ok({ awards: result.data });
  }

  const result = await findStarAwards();
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось загрузить звёзды.");
  return ok({ awards: result.data });
}

export async function createStarAward(request: Request) {
  const user = await currentUser(request);
  if (!user || (user.role !== "admin" && !(user.role === "member" && user.canReview))) {
    return failure("Только наставник может присваивать звёзды.", user ? 403 : 401);
  }
  if (!user.teamId) return failure("Сначала назначьте команду.", 400);

  try {
    const body = await readLimitedJson(request);
    const userId = body.userId;
    const awardOption = starAwardOption(body.kind);
    const comment = body.comment === undefined ? "" : body.comment;

    if (!isUuid(userId)) return failure("Некорректный участник.", 400);
    if (String(userId) === user.id) return failure("Нельзя выдавать звёзды самому себе.", 403);
    if (!awardOption) {
      return failure("Выберите Starter, Classic или Premium.", 400);
    }
    if (body.stars !== undefined && body.stars !== awardOption.stars) {
      return failure("Количество звёзд не соответствует награде.", 400);
    }
    if (!isValidComment(comment)) return failure("Комментарий слишком длинный.", 400);

    const supabase = getSupabaseAdmin();
    if (!supabase) return failure("База данных не настроена.", 503);
    const target = await supabase.from("users").select("id,name,team_id,role").eq("id", userId).maybeSingle();
    if (target.error || !target.data || target.data.team_id !== user.teamId || target.data.role !== "member") {
      return failure("Можно награждать только участников своей команды.", 403);
    }
    if (user.role === "member") {
      const { findTeamNetwork, canReviewNetwork } = await import("@/backend/services/network.service");
      const network = await findTeamNetwork(user.teamId);
      if ("unavailable" in network) return failure("База данных не настроена.", 503);
      if ("error" in network || !user.canReview || !canReviewNetwork(network.data, user.id, userId, user.role)) return failure("Этот участник не входит в вашу сеть.", 403);
    }

    const result = await insertStarAward({
      userId,
      teamId: user.teamId,
      mentorId: user.id,
      kind: awardOption.kind,
      comment: comment.trim(),
    });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("Нельзя выдавать звёзды самому себе.", 403);
    if (result.error) return failure("Не удалось присвоить звёзды.");
    await recordAudit(user, { action: "star.award", targetId: String(userId), targetLabel: String(target.data.name || ""), teamId: user.teamId, details: { stars: awardOption.stars, kind: awardOption.kind } });
    return ok({ award: result.data }, 201);
  } catch (error) {
    return requestBodyFailure(error) || failure("Некорректные данные.", 400);
  }
}

export async function deleteStarAward(request: Request, id: string) {
  const user = await currentUser(request);
  if (!isUuid(id)) return failure("Некорректная выдача звёзд.", 400);
  if (!user || (user.role !== "admin" && !(user.role === "member" && user.canReview))) return failure("Недостаточно прав.", user ? 403 : 401);
  if (!user.teamId) return failure("Сначала назначьте команду.", 400);

  const before = await auditPersonRecord("star_awards", id);
  const result = await removeStarAward(id, user);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("forbidden" in result) return failure("У вас нет доступа к этой выдаче.", 403);
  if (result.error) return failure("Не удалось отменить выдачу звёзд.");
  await recordAudit(user, { action: "star.revoke", targetId: id, targetLabel: before?.label, teamId: before?.teamId, details: before?.stars ? { stars: before.stars } : {} });
  return ok({});
}
