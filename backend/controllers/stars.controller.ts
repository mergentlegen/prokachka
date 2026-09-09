import { getRequestUser } from "@/backend/http/auth-guard";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { findAccountById } from "@/backend/services/auth.service";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { findStarAwards, insertStarAward, removeStarAward } from "@/backend/services/stars.service";

async function currentUser(request: Request) {
  const sessionUser = getRequestUser(request);
  if (!sessionUser) return null;
  if (sessionUser.id === "ceo") return sessionUser;
  return (await findAccountById(sessionUser.id)) || (process.env.NEXT_PUBLIC_SUPABASE_URL ? null : sessionUser);
}

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
    const body = await request.json();
    const userId = body.userId;
    const stars = Number(body.stars);
    const comment = body.comment === undefined ? "" : body.comment;

    if (!isUuid(userId)) return failure("Некорректный участник.", 400);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return failure("Можно присвоить от 1 до 5 звёзд.", 400);
    }
    if (!isValidComment(comment)) return failure("Комментарий слишком длинный.", 400);

    const supabase = getSupabaseAdmin();
    if (!supabase) return failure("База данных не настроена.", 503);
    const target = await supabase.from("users").select("id,team_id,role").eq("id", userId).maybeSingle();
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
      stars,
      comment: comment.trim(),
    });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if (result.error) return failure("Не удалось присвоить звёзды.");
    return ok({ award: result.data }, 201);
  } catch {
    return failure("Некорректные данные.", 400);
  }
}

export async function deleteStarAward(request: Request, id: string) {
  const user = await currentUser(request);
  if (!isUuid(id)) return failure("Некорректная выдача звёзд.", 400);
  if (!user || (user.role !== "admin" && !(user.role === "member" && user.canReview))) return failure("Недостаточно прав.", user ? 403 : 401);
  if (!user.teamId) return failure("Сначала назначьте команду.", 400);

  const result = await removeStarAward(id, user);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("forbidden" in result) return failure("У вас нет доступа к этой выдаче.", 403);
  if (result.error) return failure("Не удалось отменить выдачу звёзд.");
  return ok({});
}
