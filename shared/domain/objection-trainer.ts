// Objection trainers for programs («Я подумаю», «Дорого»): dialogue rounds (one right option of four) and one sorting round
// («Помогает» / «Вредит»). Each pick shows its comment; the site checks it (app_<kind>), and the right options come back only
// once the trainer is passed, for its material. One screen (ObjectionTrainer) shows every trainer from its data here.
export type TrainerOption = { text: string; comment: string };
export type TrainerDialogue = { kind: "chat"; title: string; chat: readonly (readonly ["client" | "me", string])[]; question: string; options: readonly TrainerOption[] };
export type TrainerSort = { kind: "sort"; title: string; question: string; phrases: readonly TrainerOption[] };
export type TrainerRound = TrainerDialogue | TrainerSort;
/** The right options once the trainer is passed: one per dialogue round, and «помогает» (true) / «вредит» (false) per phrase. */
export type TrainerKeys = { answers: number[]; sort: boolean[] };
/** A line with a bold beginning, like «Проверить: …». */
export type TrainerLine = readonly [string, string];

export type ObjectionTrainerData = {
  kind: "podumayu" | "dorogo" | "piramida" | "garantii" | "bally" | "deshevle" | "strah" | "vremya" | "semya" | "setevoy" | "nepoluchitsya" | "zarabotok" | "biznes";
  title: string;
  reward: number;
  description: string;
  intro: { heading: string; lead: string; reasons: readonly (string | TrainerLine)[]; after?: string };
  /** The rounds in order; an option is sent as its index here, a phrase of the sorting round as its index and true/false. */
  rounds: readonly TrainerRound[];
  sortStep: number;
  memo: readonly [string, string];
  steps: readonly TrainerLine[];
  /** Lines after the three steps («Никогда: …»). */
  rules?: readonly TrainerLine[];
  voice: { task: string; check: string };
};

export const trainerOption = (text: string, comment: string): TrainerOption => ({ text, comment });
