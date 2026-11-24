import { FIRST_YEAR_DESCRIPTION, FIRST_YEAR_KIND, FIRST_YEAR_REWARD, FIRST_YEAR_TITLE } from "@/shared/domain/first-year";
import { SAFETY_WATCH_DESCRIPTION, SAFETY_WATCH_KIND, SAFETY_WATCH_REWARD, SAFETY_WATCH_TITLE } from "@/shared/domain/safety-watch";
import { FREE_MEMBERSHIP_DESCRIPTION, FREE_MEMBERSHIP_KIND, FREE_MEMBERSHIP_REWARD, FREE_MEMBERSHIP_TITLE } from "@/shared/domain/free-membership";
import { MARKETING_DIRECTOR_DESCRIPTION, MARKETING_DIRECTOR_KIND, MARKETING_DIRECTOR_REWARD, MARKETING_DIRECTOR_TITLE } from "@/shared/domain/marketing-director";
import { FINAL_VOYAGE_DESCRIPTION, FINAL_VOYAGE_KIND, FINAL_VOYAGE_REWARD, FINAL_VOYAGE_TITLE } from "@/shared/domain/final-voyage";
import { PODUMAYU_DESCRIPTION, PODUMAYU_KIND, PODUMAYU_REWARD, PODUMAYU_TITLE } from "@/shared/domain/podumayu";
import { DOROGO_DESCRIPTION, DOROGO_KIND, DOROGO_REWARD, DOROGO_TITLE } from "@/shared/domain/dorogo";
import { PIRAMIDA_DESCRIPTION, PIRAMIDA_KIND, PIRAMIDA_REWARD, PIRAMIDA_TITLE } from "@/shared/domain/piramida";
import { GARANTII_DESCRIPTION, GARANTII_KIND, GARANTII_REWARD, GARANTII_TITLE } from "@/shared/domain/garantii";
import { BALLY_DESCRIPTION, BALLY_KIND, BALLY_REWARD, BALLY_TITLE } from "@/shared/domain/bally";
import { DESHEVLE_DESCRIPTION, DESHEVLE_KIND, DESHEVLE_REWARD, DESHEVLE_TITLE } from "@/shared/domain/deshevle";
import { STRAH_DESCRIPTION, STRAH_KIND, STRAH_REWARD, STRAH_TITLE } from "@/shared/domain/strah";
import { VREMYA_DESCRIPTION, VREMYA_KIND, VREMYA_REWARD, VREMYA_TITLE } from "@/shared/domain/vremya";
import { SEMYA_DESCRIPTION, SEMYA_KIND, SEMYA_REWARD, SEMYA_TITLE } from "@/shared/domain/semya";
import { SETEVOY_DESCRIPTION, SETEVOY_KIND, SETEVOY_REWARD, SETEVOY_TITLE } from "@/shared/domain/setevoy";
import { NEPOLUCHITSYA_DESCRIPTION, NEPOLUCHITSYA_KIND, NEPOLUCHITSYA_REWARD, NEPOLUCHITSYA_TITLE } from "@/shared/domain/nepoluchitsya";
import { ZARABOTOK_DESCRIPTION, ZARABOTOK_KIND, ZARABOTOK_REWARD, ZARABOTOK_TITLE } from "@/shared/domain/zarabotok";
import type { ProgramGameKey } from "@/shared/domain/types";

// Ready games a mentor can put into a program as a step (no deadline, miles right after finishing).
export type ProgramGame = { kind: ProgramGameKey; title: string; description: string; reward: number; minutes: number; icon: string };
export const PROGRAM_GAMES: readonly ProgramGame[] = [
  { kind: FIRST_YEAR_KIND, title: FIRST_YEAR_TITLE, description: FIRST_YEAR_DESCRIPTION, reward: FIRST_YEAR_REWARD, minutes: 7, icon: "⚓" },
  { kind: SAFETY_WATCH_KIND, title: SAFETY_WATCH_TITLE, description: SAFETY_WATCH_DESCRIPTION, reward: SAFETY_WATCH_REWARD, minutes: 10, icon: "🛡️" },
  { kind: FREE_MEMBERSHIP_KIND, title: FREE_MEMBERSHIP_TITLE, description: FREE_MEMBERSHIP_DESCRIPTION, reward: FREE_MEMBERSHIP_REWARD, minutes: 5, icon: "🎁" },
  { kind: MARKETING_DIRECTOR_KIND, title: MARKETING_DIRECTOR_TITLE, description: MARKETING_DIRECTOR_DESCRIPTION, reward: MARKETING_DIRECTOR_REWARD, minutes: 5, icon: "🏅" },
  { kind: FINAL_VOYAGE_KIND, title: FINAL_VOYAGE_TITLE, description: FINAL_VOYAGE_DESCRIPTION, reward: FINAL_VOYAGE_REWARD, minutes: 7, icon: "🚢" },
  { kind: PODUMAYU_KIND, title: PODUMAYU_TITLE, description: PODUMAYU_DESCRIPTION, reward: PODUMAYU_REWARD, minutes: 6, icon: "💭" },
  { kind: DOROGO_KIND, title: DOROGO_TITLE, description: DOROGO_DESCRIPTION, reward: DOROGO_REWARD, minutes: 8, icon: "💰" },
  { kind: PIRAMIDA_KIND, title: PIRAMIDA_TITLE, description: PIRAMIDA_DESCRIPTION, reward: PIRAMIDA_REWARD, minutes: 8, icon: "🔍" },
  { kind: GARANTII_KIND, title: GARANTII_TITLE, description: GARANTII_DESCRIPTION, reward: GARANTII_REWARD, minutes: 8, icon: "🤝" },
  { kind: BALLY_KIND, title: BALLY_TITLE, description: BALLY_DESCRIPTION, reward: BALLY_REWARD, minutes: 8, icon: "🪙" },
  { kind: DESHEVLE_KIND, title: DESHEVLE_TITLE, description: DESHEVLE_DESCRIPTION, reward: DESHEVLE_REWARD, minutes: 8, icon: "🏷️" },
  { kind: STRAH_KIND, title: STRAH_TITLE, description: STRAH_DESCRIPTION, reward: STRAH_REWARD, minutes: 8, icon: "🌊" },
  { kind: VREMYA_KIND, title: VREMYA_TITLE, description: VREMYA_DESCRIPTION, reward: VREMYA_REWARD, minutes: 8, icon: "⏳" },
  { kind: SEMYA_KIND, title: SEMYA_TITLE, description: SEMYA_DESCRIPTION, reward: SEMYA_REWARD, minutes: 8, icon: "🏡" },
  { kind: SETEVOY_KIND, title: SETEVOY_TITLE, description: SETEVOY_DESCRIPTION, reward: SETEVOY_REWARD, minutes: 8, icon: "🤝" },
  { kind: NEPOLUCHITSYA_KIND, title: NEPOLUCHITSYA_TITLE, description: NEPOLUCHITSYA_DESCRIPTION, reward: NEPOLUCHITSYA_REWARD, minutes: 8, icon: "🌱" },
  { kind: ZARABOTOK_KIND, title: ZARABOTOK_TITLE, description: ZARABOTOK_DESCRIPTION, reward: ZARABOTOK_REWARD, minutes: 8, icon: "🧭" },
];
export function programGame(kind: unknown) { return PROGRAM_GAMES.find((game) => game.kind === kind); }
