import { createAnnouncement, listAnnouncements } from "@/backend/controllers/announcements.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) {
  return listAnnouncements(request);
}

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "announcements-create", {
    max: 60,
    windowMs: 60_000,
    maxBodyBytes: 16 * 1024,
  });
  if (blocked) return blocked;
  return createAnnouncement(request);
}
