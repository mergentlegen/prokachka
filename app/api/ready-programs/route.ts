import { listReadyPrograms, postReadyProgram } from "@/backend/controllers/ready-programs.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) {
  return listReadyPrograms(request);
}

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "ready-programs-publish", { max: 10, windowMs: 60_000 });
  if (blocked) return blocked;
  return postReadyProgram(request);
}
