import { getCeoJournal } from "@/backend/controllers/ceo-journal.controller";

export async function GET(request: Request) {
  return getCeoJournal(request);
}
