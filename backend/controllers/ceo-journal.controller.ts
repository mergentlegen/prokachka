import { failure, ok } from "@/backend/http/api-response";
import { hasRole } from "@/backend/http/auth-guard";
import { getCurrentUser } from "@/backend/http/current-user";
import { findAuditLog } from "@/backend/services/audit-log.service";

const PAGE = 60;

// Who did what across all teams; the CEO reads it, nobody can change it.
export async function getCeoJournal(request: Request) {
  const user = await getCurrentUser(request);
  if (!hasRole(user, ["ceo"])) return failure("Недостаточно прав.", user ? 403 : 401);
  const raw = new URL(request.url).searchParams.get("before");
  const before = raw === null ? undefined : Number(raw);
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) return failure("Некорректная страница журнала.", 400);
  const result = await findAuditLog({ before, limit: PAGE + 1 });
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось загрузить журнал.");
  return ok({ entries: result.data.slice(0, PAGE), hasMore: result.data.length > PAGE });
}
