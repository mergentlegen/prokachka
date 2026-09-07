import { deleteAnnouncement, updateAnnouncement } from "@/backend/controllers/announcements.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "announcements-update", {
    max: 60,
    windowMs: 60_000,
    maxBodyBytes: 16 * 1024,
  });
  if (blocked) return blocked;
  return updateAnnouncement(request, (await context.params).id);
}

export async function DELETE(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "announcements-delete", {
    max: 30,
    windowMs: 60_000,
  });
  if (blocked) return blocked;
  return deleteAnnouncement(request, (await context.params).id);
}
