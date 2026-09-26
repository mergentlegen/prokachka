import { readWelcomeVideoSettings, removeWelcomeVideo } from "@/backend/controllers/welcome-video.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
export const GET = readWelcomeVideoSettings;
export async function DELETE(request: Request) {
  const blocked = enforceRequestSecurity(request, "welcome-video-delete", { max: 10, windowMs: 60_000 });
  return blocked || removeWelcomeVideo(request);
}
