import { getCurrentUser } from "@/backend/http/current-user";
import { teamScope } from "@/backend/http/access-scope";
import { failure, ok } from "@/backend/http/api-response";
import { findRanking, findStarRanking } from "@/backend/services/ranking.service";
import { courseRanking } from "@/shared/domain/star-course";

export async function listRanking(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const scope = teamScope(user);
  if (!scope) return ok({ ranking: [] });
  const [pointsResult, starsResult] = await Promise.all([findRanking(scope), findStarRanking(scope)]);
  if ("unavailable" in pointsResult) return failure("База данных не настроена.", 503);
  if (pointsResult.error) return failure("Не удалось загрузить рейтинг.");
  if ("unavailable" in starsResult) return failure("База данных не настроена.", 503);
  if (starsResult.error) return failure("Не удалось загрузить рейтинг звёзд.");
  // The only team rating is «Звёздный курс», built from everyone's miles and stars.
  return ok({ ranking: courseRanking(pointsResult.data, starsResult.data) });
}
