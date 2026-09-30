import { recordCompletion } from "@/backend/controllers/submissions.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "submissions-mentor-record", { max: 60, windowMs: 60_000 });
  if (blocked) return blocked;
  return recordCompletion(request);
}
