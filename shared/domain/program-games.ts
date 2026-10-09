import { FIRST_YEAR_DESCRIPTION, FIRST_YEAR_KIND, FIRST_YEAR_REWARD, FIRST_YEAR_TITLE } from "@/shared/domain/first-year";
import { SAFETY_WATCH_DESCRIPTION, SAFETY_WATCH_KIND, SAFETY_WATCH_REWARD, SAFETY_WATCH_TITLE } from "@/shared/domain/safety-watch";
import type { ProgramGameKey } from "@/shared/domain/types";

// Ready games a mentor can put into a program as a step (no deadline, miles right after finishing).
export type ProgramGame = { kind: ProgramGameKey; title: string; description: string; reward: number; minutes: number; icon: string };
export const PROGRAM_GAMES: readonly ProgramGame[] = [
  { kind: FIRST_YEAR_KIND, title: FIRST_YEAR_TITLE, description: FIRST_YEAR_DESCRIPTION, reward: FIRST_YEAR_REWARD, minutes: 7, icon: "⚓" },
  { kind: SAFETY_WATCH_KIND, title: SAFETY_WATCH_TITLE, description: SAFETY_WATCH_DESCRIPTION, reward: SAFETY_WATCH_REWARD, minutes: 10, icon: "🛡️" },
];
export function programGame(kind: unknown) { return PROGRAM_GAMES.find((game) => game.kind === kind); }
