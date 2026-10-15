import { removeReview } from "@/backend/controllers/reviews.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  const blocked = enforceRequestSecurity(request, "reviews-delete", { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  return removeReview(request, (await context.params).id);
}
