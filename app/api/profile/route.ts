import { updateOwnProfile } from "@/backend/controllers/profile.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export const runtime = "nodejs";
export async function PATCH(request: Request) {
  const blocked = enforceRequestSecurity(request, "profile-update", { max: 20, maxBodyBytes: 768 * 1024 });
  return blocked || updateOwnProfile(request);
}
