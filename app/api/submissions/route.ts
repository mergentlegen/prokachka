import { createSubmission, listSubmissions } from "@/backend/controllers/submissions.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) { return listSubmissions(request); }
export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "submissions-create", { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  return createSubmission(request);
}