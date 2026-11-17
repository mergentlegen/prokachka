// Cabinet trainers: a copy of the club cabinet where a participant finds places by tapping them (missions),
// answers a question after some missions, then passes a short check where a mistake takes one question back.
// Each trainer is a program game with its own data (shared/domain/<trainer>.ts) and cabinet screens;
// the engine is frontend/features/member/CabinetTrainer.tsx, the rules on the site are SQL app_<trainer>.
export type TrainerAsk = { q: string; opts: string[]; right: number; why: string };
export type TrainerMission = {
  /** The cabinet screen the mission opens on. */ view: string;
  /** The places to tap in order (`data-hot` names); `scroll` — scroll the wide table to the right. */ seq: string[];
  /** The task in the mission card; the bar at the bottom shows `stepText` for each tap when there are several. */ text: string;
  stepText?: string[];
  /** What to say when a wrong place is tapped, by its name. */ hints: Record<string, string>;
  ok: string; okText: string; ask?: TrainerAsk;
};
export type TrainerQuestion = { q: string; opts: string[]; right: number };
/** A card of the first screen; text may hold <b>…</b> marks and line breaks. */
export type TrainerCard = { icon?: string; title: string; text: string };
/** What a tap changes in the cabinet: the screen, and the menu (open, with «Платежи» unfolded, closed). */
export type TrainerEffect = { view?: string; menu?: "open" | "pay" | "closed" };

export type CabinetTrainer = {
  kind: string; title: string; description: string; reward: number; minutes: number; icon: string;
  intro: { title: string; lead: string; cards: readonly TrainerCard[] };
  missions: readonly TrainerMission[];
  quiz: readonly TrainerQuestion[];
  /** Tap effects by place name: applied at once on a middle step, after the green flash on the last one. */
  effects?: Record<string, TrainerEffect>;
  /** «Запомни главное» on the results screen and in the material. */ summary: string;
  /** The first line of the reading page after the trainer. */ materialLead: string;
  /** The line under the miles at the end. */ doneText: string;
};

/** Where a mistake happened: `m3` — mission 3, `q2` — question 2 of the check. Kept short so the site can store them. */
export function trainerErrorLabel(trainer: Pick<CabinetTrainer, "missions" | "quiz">, key: string) {
  const mission = /^m([1-9])$/.exec(key);
  if (mission && Number(mission[1]) <= trainer.missions.length) return `Миссия ${mission[1]}: ${trainer.missions[Number(mission[1]) - 1].text}`;
  const question = /^q([1-9])$/.exec(key);
  if (question && Number(question[1]) <= trainer.quiz.length) return `Итоговая проверка: ${trainer.quiz[Number(question[1]) - 1].q}`;
  return null;
}

/** The right option of each question after a mission, by mission number — the site checks the same. */
export function trainerAskKeys(trainer: Pick<CabinetTrainer, "missions">) {
  return Object.fromEntries(trainer.missions.flatMap((mission, index) => mission.ask ? [[index + 1, mission.ask.right]] : [])) as Record<number, number>;
}
