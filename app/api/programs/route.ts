import { listPrograms, postProgram } from "@/backend/controllers/programs.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
export async function GET(request: Request) { return listPrograms(request); }
export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "programs-create", { max: 20, windowMs: 60_000 });
  if (blocked) return blocked;
  return postProgram(request);
}
