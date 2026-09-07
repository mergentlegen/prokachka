import { listUsers, upsertUser } from "@/backend/controllers/users.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) { return listUsers(request); }
export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "users-create", { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  return upsertUser(request);
}