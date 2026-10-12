import { changePassword } from "@/backend/controllers/profile.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "profile-password", { max: 10 });
  return blocked || changePassword(request);
}
