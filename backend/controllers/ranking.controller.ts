import { getCurrentUser } from "@/backend/http/current-user";
import { teamScope } from "@/backend/http/access-scope";
import { failure, ok } from "@/backend/http/api-response";
import { findMemberLevel, findRanking, findStarRanking, markMemberLevelSeen } from "@/backend/services/ranking.service";

// Two team ratings, by miles and by stars, for the whole time in the team; plus the viewer's level and a pending congratulation.
export async function listRanking(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const scope = teamScope(user);
  if (!scope) return ok({ ranking: [], starRanking: [], level: 1, levelUp: null });
  const [pointsResult, starsResult, level] = await Promise.all([findRanking(scope), findStarRanking(scope), findMemberLevel(user.id)]);
  if ("unavailable" in pointsResult) return failure("База данных не настроена.", 503);
  if (pointsResult.error) return failure("Не удалось загрузить рейтинг.");
  if ("unavailable" in starsResult) return failure("База данных не настроена.", 503);
  if (starsResult.error) return failure("Не удалось загрузить рейтинг звёзд.");
  return ok({ ranking: pointsResult.data, starRanking: starsResult.data, level: level.level, levelUp: user.role === "member" ? level.levelUp : null });
}

export async function markLevelSeen(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (user.role !== "member") return ok({ seen: false });
  const result = await markMemberLevelSeen(user.id);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось сохранить.");
  return ok({ seen: result.data });
}
