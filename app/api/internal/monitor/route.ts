import { failure, ok } from "@/backend/http/api-response";
import { isInternalRequest } from "@/backend/http/internal-auth";
import { monitorSnapshot } from "@/backend/services/monitor.service";

export const dynamic = "force-dynamic";

// Read by the server's health monitor every few minutes; never reachable without the internal secret.
export async function GET(request: Request) {
  if (!isInternalRequest(request)) return failure("Доступ запрещён.", 401);
  try {
    const result = await monitorSnapshot();
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("error" in result) return failure("База данных не отвечает.", 503);
    return ok({ monitor: result.data });
  } catch { return failure("База данных не отвечает.", 503); }
}
