import type { ReadyProgramKey, TaskInteractiveKind, TaskPublicationType } from "./types";
import { HEART_SURVEY } from "@/shared/domain/heart-survey";
import { COMPANY_VOYAGE_REWARD, COMPANY_VOYAGE_TITLE } from "@/shared/domain/company-voyage";
import { CAPTAIN_CRUISE_TITLE, CAPTAIN_CRUISE_REWARD } from "@/shared/domain/captain-cruise";

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
  {
    key: "company-voyage", title: COMPANY_VOYAGE_TITLE, eyebrow: "О компании · правда или миф",
    description: "Девять карточек о компании, 18 вопросов «Правда или миф» и свой рассказ за 60 секунд голосовым наставнику. Мили начисляет наставник, когда послушает.",
    badge: "Без дедлайна", taskCount: 1,
    tasks: [{ title: COMPANY_VOYAGE_TITLE, description: "Познакомься с компанией, пройди игру «Правда или миф» без ошибок и получи 2 мили автоматически. Затем собери свой рассказ для наставника.", maxPoints: COMPANY_VOYAGE_REWARD, publicationType: "evergreen", interactiveKind: "company-voyage" }],
  },
  {
    key: "captain-cruise", title: CAPTAIN_CRUISE_TITLE, eyebrow: "Тренажёр поиска круиза",
    description: "Пройди путь от поиска до выбора каюты: направления, линии, даты, пассажиры и цена. Затем покажи настоящий круиз наставнику.",
    badge: "Без дедлайна", taskCount: 1,
    tasks: [{ title: CAPTAIN_CRUISE_TITLE, description: "Пройди тренировку и получи 19 миль. Найди круиз в своём кабинете inCruises и отправь скриншот наставникам через Telegram — ещё 1 миля автоматически.", maxPoints: CAPTAIN_CRUISE_REWARD, publicationType: "evergreen", interactiveKind: "captain-cruise" }],
  },
  {
    key: "count-your-dream", title: "Посчитай свою мечту", eyebrow: "Интерактивный расчёт мечты",
    description: "Назови мечту, рассчитай путь к ней, сравни два сценария и расскажи наставнику, что для тебя важно.",
    badge: "Без дедлайна", taskCount: 1,
    tasks: [{ title: "Посчитай свою мечту", description: "Пройди интерактивный тренажёр: посчитай стоимость мечты, срок накопления и второй путь. За завершение — 10 миль. После прохождения можно записать голосовое наставнику в Telegram.", maxPoints: 10, publicationType: "evergreen", interactiveKind: "count-your-dream" }],
  },
  {
    key: "dream-route", title: "Мечта → маршрут", eyebrow: "Интерактивный маршрут новичка",
    description: "Пройди путь от своей мечты до первого действия: сравни бизнес с нуля и готовую систему, открой четыре станции и проверь знания. В конце составь план и расскажи о нём наставнику.",
    badge: "Без дедлайна", taskCount: 1,
    tasks: [{ title: "Мечта → маршрут", description: "Пройди интерактивный маршрут, запиши мечту, изучи станции, ответь на пять вопросов и составь свой первый план. За завершение — 10 миль; после можно отправить голосовое наставникам своей ветки в Telegram.", maxPoints: 10, publicationType: "evergreen", interactiveKind: "dream-route" }],
  },
];

export function readyProgramByKey(key: unknown) {
  return READY_PROGRAMS.find((program) => program.key === key);
}
