import { getCurrentUser } from "@/backend/http/current-user";
import { teamScope } from "@/backend/http/access-scope";
import { failure, ok } from "@/backend/http/api-response";
import { findCourseStandings, findPendingLevelUp, markMemberLevelSeen } from "@/backend/services/ranking.service";
import { courseRanking } from "@/shared/domain/star-course";

// The rating is XP («Опыт», formerly «Звёздный курс») of the viewer's level: only those on the same level, with that level's miles and stars.
export async function listRanking(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  const scope = teamScope(user);
  if (!scope) return ok({ ranking: [], level: 1, levelUp: null });
  const result = await findCourseStandings(scope);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось загрузить рейтинг.");
  const mine = result.data.find((row) => row.id === user.id);
  const level = mine?.level ?? 1;
  const levelUp = mine && level > 1 ? await findPendingLevelUp(user.id) : null;
  return ok({ ranking: courseRanking(result.data.filter((row) => row.level === level)), level, levelAt: mine?.levelAt, levelUp });
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
