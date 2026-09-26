import type { ReadyProgramKey, TaskInteractiveKind, TaskPublicationType } from "./types";
import { HEART_SURVEY } from "@/shared/domain/heart-survey";

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
  {
    key: "starter-rules",
    title: "Правила игры",
    eyebrow: "Старт новичка",
    description: "Разберись, как устроены задания, мили, звёзды и поддержка наставника. Пять вопросов помогут закрепить правила старта.",
    badge: "Без дедлайна",
    taskCount: 1,
    tasks: [{
      title: "Правила игры",
      description: "Познакомься с правилами «Старта новичка» и ответь на пять вопросов. Пройди тест без ошибок и получи 5 миль автоматически.",
      maxPoints: 5,
      publicationType: "evergreen",
      interactiveKind: "starter-rules",
    }],
  },
  {
    key: "heart-survey", title: HEART_SURVEY.title, eyebrow: "Опросник о путешествиях",
    description: "Пять честных вопросов о твоих мечтах. За каждый ответ — 1 миля. Результат поможет наставникам лучше узнать тебя.",
    badge: "Без дедлайна", taskCount: 1,
    tasks: [{ title: HEART_SURVEY.title, description: "Узнай, какое путешествие тебе нужно. Здесь нет неправильных ответов: каждый сохранённый выбор приносит 1 милю, а итог автоматически приходит наставникам твоей ветки.", maxPoints: 5, publicationType: "evergreen", interactiveKind: "heart-survey" }],
  },
];

export function readyProgramByKey(key: unknown) {
  return READY_PROGRAMS.find((program) => program.key === key);
}
