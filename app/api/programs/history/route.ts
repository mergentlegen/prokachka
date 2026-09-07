import { listProgramHistory } from "@/backend/controllers/programs.controller";

export async function GET(request: Request) {
  return listProgramHistory(request);
}
