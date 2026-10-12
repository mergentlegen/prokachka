import { listVisiblePhones } from "@/backend/controllers/profile.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) {
  const blocked = enforceRequestSecurity(request, "contacts-read", { max: 60 });
  return blocked || listVisiblePhones(request);
}
