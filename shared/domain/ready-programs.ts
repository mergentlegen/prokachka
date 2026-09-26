import type { ReadyProgramKey, TaskInteractiveKind, TaskPublicationType } from "./types";

export type ReadyProgramTask = {
  title: string;
  description: string;
  maxPoints: number;
  publicationType: TaskPublicationType;
  interactiveKind: TaskInteractiveKind;
};

export type ReadyProgramDefinition = {
  key: ReadyProgramKey;
  title: string;
  eyebrow: string;
  description: string;
  badge: string;
  taskCount: number;
  tasks: readonly ReadyProgramTask[];
};

export const READY_PROGRAMS: readonly ReadyProgramDefinition[] = [
  {
    key: "dream-plan",
    title: "Мечта с планом",
    eyebrow: "Игра и тест",
    description: "Мини-игра о двух путях к круизу и пять вопросов о привычках, которые помогают увидеть силу плана.",
    badge: "Без дедлайна",
    taskCount: 1,
    tasks: [
      {
        title: "Мечта с планом",
        description: "Пройди интерактивную игру «Круиз: сама или через клуб?», сравни два пути к мечте и ответь на пять вопросов.",
        maxPoints: 5,
        publicationType: "evergreen",
        interactiveKind: "dream-plan",
      },
    ],
  },
];

export function readyProgramByKey(key: unknown) {
  return READY_PROGRAMS.find((program) => program.key === key);
}
