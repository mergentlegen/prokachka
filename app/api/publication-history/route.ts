import { listPublicationHistory } from "@/backend/controllers/publication-history.controller";

export async function GET(request: Request) {
  return listPublicationHistory(request);
}
