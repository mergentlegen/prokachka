import { getCeoStats } from "@/backend/controllers/ceo-stats.controller";

export async function GET(request: Request) {
  return getCeoStats(request);
}
