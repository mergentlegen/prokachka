import { markLevelSeen } from "@/backend/controllers/ranking.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "level-seen", { max: 30, windowMs: 60_000, maxBodyBytes: 0 });
  if (blocked) return blocked;
  return markLevelSeen(request);
}
