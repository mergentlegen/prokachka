import { createStarAward, listStars } from "@/backend/controllers/stars.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) {
  return listStars(request);
}

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "stars-create", { max: 60, windowMs: 60_000, maxBodyBytes: 16 * 1024 });
  if (blocked) return blocked;
  return createStarAward(request);
}
