import { finishWelcomeVideo } from "@/backend/controllers/welcome-video.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "welcome-video-finish", { max: 10, windowMs: 60_000, maxBodyBytes: 16 * 1024 });
  return blocked || finishWelcomeVideo(request);
}
