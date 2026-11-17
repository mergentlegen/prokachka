// «Путь к Маркетинг директору»: a cabinet trainer (see shared/domain/cabinet-trainer.ts), placed as a step inside a program.
// Six missions in a copy of the cabinet: the calendar month, the way through the menu to «Командный лидерский бонус»
// and the two conditions of the rank there; then a check of four questions. The site checks the answers
// (see app_marketing_director) and gives the miles once. Names and numbers in the cabinet are made up for training.
import type { CabinetTrainer, TrainerCard, TrainerMission, TrainerQuestion } from "@/shared/domain/cabinet-trainer";

export const MARKETING_DIRECTOR_KIND = "marketing-director";
export const MARKETING_DIRECTOR_TITLE = "Путь к Маркетинг директору";
export const MARKETING_DIRECTOR_DESCRIPTION = "Тренажёр кабинета: за 5 минут научись находить в кабинете свой путь к рангу Маркетинг директор — два условия месяца, лимит на одну ветку и где всё это смотреть.";
export const MARKETING_DIRECTOR_REWARD = 2;

/** The cards of the first screen. */
export const MARKETING_DIRECTOR_INTRO: readonly TrainerCard[] = [
  { icon: "🆕", title: "1. Новый оборот — $600", text: "Оплаты новых членов клуба в твоей команде за этот месяц." },
  { icon: "👥", title: "2. Общий оборот команды — $3\u00A0000", text: "С одной ветки засчитывается <b>не больше $1\u00A0200</b>." },
  { title: "Шпаргалка: как это написано в кабинете", text: "«Требуемый активационный объём» → <b>Новый оборот</b>\n«Требования к квалифицированному товарообороту» → <b>Общий оборот команды</b>\n«Максимум на одну ветку» → <b>с одной ветки до $1\u00A0200</b>" },
];

export const MARKETING_DIRECTOR_MISSIONS: readonly TrainerMission[] = [
  { view: "home", seq: ["timerCal"],
    text: "Найди, сколько дней осталось до конца КАЛЕНДАРНОГО месяца.",
    hints: { timerPers: "Это твой личный месяц. Календарный — тот, где написано «До конца месяца»." },
    ok: "Верно! Это календарный месяц",
    okText: "С 1-го по последнее число, одинаковый для всех. За это время нужно выполнить оба условия ранга МД." },

  { view: "home", seq: ["burger", "mPay", "mComp", "compTLB"],
    text: "Найди раздел, где виден твой путь к рангу Маркетинг директор.",
    stepText: ["Открой меню ☰ в левом верхнем углу.", "Нажми «Платежи».", "Выбери «Компенсация».", "Пролистай вниз и нажми «Командный лидерский бонус»."],
    hints: { timerCal: "Это таймер. Путь к рангу спрятан в меню ☰.", timerPers: "Это таймер. Путь к рангу спрятан в меню ☰.", direct: "Это безоплатное членство. Путь к рангу — в меню ☰.",
      mOther: "Путь к рангу — в разделе «Платежи». Он внизу меню.", mWallet: "Кошелёк — это твои деньги. А путь к рангу — в «Компенсации».",
      compOther: "Это другой бонус. Нужен «Командный лидерский бонус» — пролистай ниже." },
    ok: "Ты на месте!",
    okText: "Запомни путь: Меню → Платежи → Компенсация → Командный лидерский бонус." },

  { view: "bonus", seq: ["mdBlock"],
    text: "Пролистай вниз и найди блок «Маркетинг директор бонус».",
    hints: { actTop: "Верхние цифры сейчас не нужны. Пролистай ниже.", qualProd: "Верхние цифры сейчас не нужны. Пролистай ниже.", totalProd: "Верхние цифры сейчас не нужны. Пролистай ниже.",
      month: "Это выбор месяца. Нужный блок — ниже.", breakdown: "Это уже слишком далеко. Нужный блок — чуть выше." },
    ok: "Есть!",
    okText: "Всё про ранг МД — в этом блоке. Здесь две строки — это и есть два условия." },

  { view: "bonus", seq: ["mdActivation"],
    text: "Условие 1: найди НОВЫЙ ОБОРОТ. В кабинете он называется «Требуемый активационный объём».",
    hints: { mdTurnover: "Это общий оборот команды. Новый оборот — строка прямо над ним.", mdBlock: "Тепло! Нажми на строку «Требуемый активационный объём».", actTop: "Нужная строка — ниже, в блоке «Маркетинг директор бонус»." },
    ok: "Верно — $300 из $600!",
    okText: "Новый оборот — это оплаты новых членов клуба в твоей команде за этот месяц. Нужно $600.",
    ask: { q: "Сколько нового оборота ещё не хватает?", opts: ["$600", "$300", "$900"], right: 1,
      why: "Нужно $600, набрано $300. Из большего вычти меньшее." } },

  { view: "bonus", seq: ["mdTurnover"],
    text: "Условие 2: найди ОБЩИЙ ОБОРОТ КОМАНДЫ. В кабинете — «Требования к квалифицированному товарообороту».",
    hints: { mdActivation: "Это новый оборот. Общий оборот команды — строка ниже.", mdBlock: "Тепло! Нажми на строку «Требования к квалифицированному товарообороту».", qualProd: "Нужная строка — ниже, в блоке «Маркетинг директор бонус»." },
    ok: "Верно — $1,200 из $3,000!",
    okText: "Общий оборот команды — нужно $3,000.",
    ask: { q: "Сколько общего оборота команды ещё не хватает?", opts: ["$3,000", "$1,800", "$1,200"], right: 1,
      why: "Нужно $3,000, набрано $1,200. Из большего вычти меньшее." } },

  { view: "bonus", seq: ["branchMax"],
    text: "Найди строку «Максимум на одну ветку».",
    hints: { mdTurnover: "Тепло! Строка прямо внутри этого блока, внизу.", mdBlock: "Тепло! Она под общим оборотом команды.", breakdown: "Нужная строка — выше, в блоке «Маркетинг директор бонус»." },
    ok: "Верно!",
    okText: "Ветка — это команда, которая идёт от одного твоего лично приглашённого человека.",
    ask: { q: "Одна ветка принесла $3,000. Сколько засчитается к рангу?", opts: ["$3,000", "$1,200", "$0"], right: 1,
      why: "С одной ветки засчитывается до $1,200. Поэтому МД строится несколькими ветками, а не одной." } },
];

/** The final check. A wrong answer takes one question back. */
export const MARKETING_DIRECTOR_QUIZ: readonly TrainerQuestion[] = [
  { q: "Ранг Маркетинг директор считается за…", opts: ["а) календарный месяц", "б) твой личный месяц", "в) неделю"], right: 0 },
  { q: "Сколько условий у ранга МД?", opts: ["а) одно", "б) два — новый оборот $600 и общий оборот команды $3,000", "в) три"], right: 1 },
  { q: "Сколько засчитывается с одной ветки?", opts: ["а) всё, что она принесла", "б) до $1,200", "в) $600"], right: 1 },
  { q: "Где смотреть свой путь к рангу МД?", opts: ["а) на Главной", "б) Меню → Платежи → Компенсация → Командный лидерский бонус → блок «Маркетинг директор бонус»", "в) в Кошельке"], right: 1 },
];

export const MARKETING_DIRECTOR_SUMMARY = "Запомни главное: ранг МД — за <b>календарный месяц</b>, два условия: <b>новый оборот $600</b> и <b>общий оборот команды $3\u00A0000</b> (с одной ветки до $1\u00A0200). Где смотреть: <b>Меню → Платежи → Компенсация → Командный лидерский бонус → блок «Маркетинг директор бонус»</b>.";

/** The menu of the training cabinet; only «Платежи» opens. */
export const MARKETING_DIRECTOR_MENU = [
  ["🏠", "Приветствуем", false], ["🚢", "inCruises", true], ["🏨", "inStays", true], ["🧭", "inTours", true], ["💼", "Бизнес-центр", true],
  ["ℹ️", "Инфо-центр", true], ["👥", "Контакты", true], ["✉️", "Почта", true], ["📚", "Ресурсы", true], ["📖", "Обучение", true],
] as const;
/** The bonuses on the «Компенсация» page; only «Командный лидерский бонус» leads on. */
export const MARKETING_DIRECTOR_BONUSES = [
  ["⚡", "Бонусы за активацию", "Ежедневные и ежемесячные", false], ["🤝", "Матчинг-бонусы", "Еженедельные", false], ["🔁", "Рекуррентный доход", "Ежемесячный", false],
  ["🏅", "Командный лидерский бонус", "Ранги и квалификация", true], ["🏛️", "Бонус «Фундамент бизнеса»", "Ежемесячный", false],
] as const;
/** The branches in «Разбивка по товарообороту»: together the $1,200 of the team turnover. */
export const MARKETING_DIRECTOR_BRANCHES = [
  { initials: "ДК", name: "Данияр К.", role: "Партнёр / Член клуба Premium", color: "#0EA5E9", sum: "$700" },
  { initials: "МТ", name: "Мадина Т.", role: "Член клуба Premium", color: "#F59E0B", sum: "$300" },
  { initials: "ОВ", name: "Ольга В.", role: "Член клуба Classic", color: "#7C3AED", sum: "$200" },
] as const;

/** The whole trainer for the engine (frontend/features/member/CabinetTrainer.tsx). */
export const MARKETING_DIRECTOR_TRAINER: CabinetTrainer = {
  kind: MARKETING_DIRECTOR_KIND, title: MARKETING_DIRECTOR_TITLE, description: MARKETING_DIRECTOR_DESCRIPTION, reward: MARKETING_DIRECTOR_REWARD, minutes: 5, icon: "🏅",
  intro: { title: "Путь к Маркетинг директору", lead: "Чтобы стать Маркетинг директором, за <b>один календарный месяц</b> (с 1-го по последнее число) нужно выполнить <b>два условия</b>:", cards: MARKETING_DIRECTOR_INTRO },
  missions: MARKETING_DIRECTOR_MISSIONS, quiz: MARKETING_DIRECTOR_QUIZ,
  effects: { burger: { menu: "open" }, mPay: { menu: "pay" }, mComp: { menu: "closed", view: "comp" }, compTLB: { view: "bonus" } },
  summary: MARKETING_DIRECTOR_SUMMARY,
  materialLead: "Памятка тренажёра: два условия ранга Маркетинг директор, лимит на одну ветку и где всё это смотреть в кабинете.",
  doneText: "Теперь ты знаешь, где в кабинете смотреть свой путь к рангу Маркетинг директор. Загляни туда в своём настоящем кабинете 🙂",
};
