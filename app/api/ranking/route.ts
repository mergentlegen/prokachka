import { listRanking } from "@/backend/controllers/ranking.controller";

export async function GET(request: Request) { return listRanking(request); }