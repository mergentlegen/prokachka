import { listReviews, writeReview } from "@/backend/controllers/reviews.controller";
import { enforceRequestSecurity } from "@/backend/http/security";

export async function GET(request: Request) {
  return listReviews(request);
}

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "reviews-write", { max: 20, windowMs: 60_000, maxBodyBytes: 20 * 1024 * 1024 });
  if (blocked) return blocked;
  return writeReview(request);
}
