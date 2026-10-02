import { failure, ok } from "@/backend/http/api-response";
import { hasRole } from "@/backend/http/auth-guard";
import { getCurrentUser } from "@/backend/http/current-user";
import { findCeoStats } from "@/backend/services/ceo-stats.service";

// Platform-wide activity is visible to the CEO only.
export async function getCeoStats(request: Request) {
  const user = await getCurrentUser(request);
  if (!hasRole(user, ["ceo"])) return failure("Недостаточно прав.", user ? 403 : 401);
  const result = await findCeoStats();
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось посчитать статистику.");
  return ok({ stats: result.data });
}
