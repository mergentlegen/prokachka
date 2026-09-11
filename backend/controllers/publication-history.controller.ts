import { getRequestUser } from "@/backend/http/auth-guard";
import { failure, ok } from "@/backend/http/api-response";
import { findAccountById } from "@/backend/services/auth.service";
import { findPublicationHistory } from "@/backend/services/publication-history.service";

async function currentUser(request: Request) {
  const sessionUser = getRequestUser(request);
  if (!sessionUser) return null;
  if (sessionUser.id === "ceo") return sessionUser;
  return (await findAccountById(sessionUser.id)) || (process.env.NEXT_PUBLIC_SUPABASE_URL ? null : sessionUser);
}

export async function listPublicationHistory(request: Request) {
  const user = await currentUser(request);
  if (!user || (user.role !== "ceo" && user.role !== "admin" && !user.canReview && !user.canPublishTasks)) {
    return failure("Недостаточно прав.", user ? 403 : 401);
  }
  if (user.role !== "ceo" && !user.teamId) return ok({ history: [] });
  const result = await findPublicationHistory(user.teamId || "", user);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось загрузить историю публикаций.");
  return ok({ history: result.data });
}
