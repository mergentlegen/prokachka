import { cancelWelcomeVideo, requestWelcomeVideoUpload } from "@/backend/controllers/welcome-video.controller";
import { enforceRequestSecurity } from "@/backend/http/security";
export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "welcome-video-upload-intent", { max: 10, windowMs: 60_000, maxBodyBytes: 16 * 1024 });
  return blocked || requestWelcomeVideoUpload(request);
}
export async function DELETE(request: Request) {
  const blocked = enforceRequestSecurity(request, "welcome-video-cancel-intent", { max: 20, windowMs: 60_000, maxBodyBytes: 16 * 1024 });
  return blocked || cancelWelcomeVideo(request);
}
