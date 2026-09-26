import { markWelcomeVideoComplete } from "@/backend/controllers/welcome-video.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "welcome-video-complete", { max: 12, windowMs: 60_000 });
  return blocked || markWelcomeVideoComplete(request);
}
