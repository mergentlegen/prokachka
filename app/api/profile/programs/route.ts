import { listMyPrograms } from "@/backend/controllers/profile.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) {
  const blocked = enforceRequestSecurity(request, "profile-programs", { max: 60 });
  return blocked || listMyPrograms(request);
}
