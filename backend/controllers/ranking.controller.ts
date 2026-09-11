import { getRequestUser } from "@/backend/http/auth-guard";
import { failure, ok } from "@/backend/http/api-response";
import { findRanking, findStarRanking } from "@/backend/services/ranking.service";
import { findAccountById } from "@/backend/services/auth.service";

export async function listRanking(request: Request) {
  const user = getRequestUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if ((user.role === "member" || user.role === "admin") && !user.teamId) return ok({ ranking: [], starRanking: [] });
  const current = user.id === "ceo" ? user : (await findAccountById(user.id)) || (process.env.NEXT_PUBLIC_SUPABASE_URL ? null : user);
  if (!current) return failure("Пользователь не найден.", 401);
  const teamId = current.role === "ceo" ? undefined : current.teamId;
  const pointsResult = await findRanking(teamId);
  if ("unavailable" in pointsResult) return failure("База данных не настроена.", 503);
  if (pointsResult.error) return failure("Не удалось загрузить рейтинг.");
  const starsResult = await findStarRanking(teamId);
  return ok({
    ranking: pointsResult.data,
    // A broken/empty optional stars query must not block the main points rating or login.
    starRanking: "data" in starsResult ? starsResult.data : [],
  });
}
