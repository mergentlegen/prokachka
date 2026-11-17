// «Безоплатное членство»: a trainer of the club cabinet, placed as a step inside a program.
// Seven missions in a copy of the cabinet (find the right place, sometimes answer a question), then a check of
// five questions where a mistake takes one question back. The site checks the answers (see app_free_membership)
// and gives the miles once. Names and numbers in the cabinet are made up for training.
export const FREE_MEMBERSHIP_KIND = "free-membership";
export const FREE_MEMBERSHIP_TITLE = "Безоплатное членство";
export const FREE_MEMBERSHIP_DESCRIPTION = "Тренажёр кабинета: за 3 минуты научись проверять, подтверждается ли твоё безоплатное членство в этом месяце, — личный месяц, прямой объём и кто из приглашённых уже оплатил.";
export const FREE_MEMBERSHIP_REWARD = 2;

/** The cards of the first screen. */
export const FREE_MEMBERSHIP_INTRO = [
  { icon: "🎁", title: "Безоплатное членство", text: "Если за твой личный месяц твои <b>лично приглашённые</b> члены клуба оплатят членство на <b>$500</b>, компания отменит <b>до $100</b> твоего ежемесячного взноса. 200 бонусных баллов тебе всё равно начислят." },
  { icon: "👤", title: "Личный месяц", text: "Это твой собственный цикл: <b>от дня твоей оплаты до следующего счёта</b>. У каждого он начинается в свой день." },
] as const;

/** Places of the cabinet copy a participant can tap. `scroll` is the table that has to be scrolled to the right. */
export type FreeMembershipSpot = "timerCal" | "timerPers" | "direct" | "avatars" | "money"
  | "typeMadina" | "typeDaniyar" | "typeKarim" | "sumMadina" | "sumDaniyar" | "sumKarim";
export type FreeMembershipAsk = { q: string; opts: string[]; right: number; why: string };
export type FreeMembershipMission = {
  view: "home" | "list"; target: FreeMembershipSpot | "scroll"; text: string;
  hints: Partial<Record<FreeMembershipSpot, string>>; ok: string; okText: string; ask?: FreeMembershipAsk;
};

export const FREE_MEMBERSHIP_MISSIONS: readonly FreeMembershipMission[] = [
  { view: "home", target: "timerPers",
    text: "Найди, сколько дней осталось до конца твоего ЛИЧНОГО месяца.",
    hints: { timerCal: "Это календарный месяц — он одинаковый для всех. Тебе нужен таймер про счёт на оплату членства." },
    ok: "Верно! Это твой личный месяц",
    okText: "Он идёт от дня твоей оплаты до следующего счёта. До конца этого таймера нужно набрать $500." },

  { view: "home", target: "money",
    text: "Найди, сколько прямого объёма уже набрано в этом личном месяце.",
    hints: { timerPers: "Таймер показывает время, а нам нужна сумма в долларах.", direct: "Тепло! Нажми на саму сумму справа.", avatars: "Тепло! А сумма — справа от аватарок." },
    ok: "Есть!",
    okText: "Прямой объём по членству — это оплаты членства людей, которых ты лично пригласил(а) в клуб.",
    ask: { q: "Сколько ещё не хватает до безоплатного членства?", opts: ["$500", "$50", "$450"], right: 1,
      why: "Нужно $500, набрано $450. Из большего вычти меньшее." } },

  { view: "home", target: "avatars",
    text: "Узнай, кто именно принёс эту сумму. Подсказка: нажми на то, что похоже на людей.",
    hints: { money: "Это сумма. А люди — слева от неё.", direct: "Тепло! Нажми на кружочки с людьми.", timerPers: "Нам нужна карточка «Прямой объём по членству»." },
    ok: "Список открыт!",
    okText: "Это твои лично приглашённые члены клуба, которые уже оплатили членство в этом личном месяце. Здесь только те, чья оплата уже поступила." },

  { view: "list", target: "typeDaniyar",
    text: "Найди, какой план членства у Данияра.",
    hints: { typeMadina: "Это план Мадины. Ищи строку Данияра.", typeKarim: "Это план Карима. Ищи строку Данияра." },
    ok: "Верно — Premium!",
    okText: "Ежемесячный взнос: Premium — $250, Classic — $100, Starter — $50. Запомни, что у Данияра Premium, — дальше будет сюрприз." },

  { view: "list", target: "scroll",
    text: "Таблица шире экрана. Пролистай её пальцем ВПРАВО до конца.",
    hints: {}, ok: "Отлично!",
    okText: "Многие не знают, что справа есть ещё колонки. Здесь «Статус» и «Сумма» — сколько от каждого человека зачислено в твой прямой объём." },

  { view: "list", target: "sumDaniyar",
    text: "Найди, сколько зачислено от Данияра.",
    hints: { sumMadina: "Это сумма Мадины. Ищи строку Данияра.", sumKarim: "Это сумма Карима. Ищи строку Данияра." },
    ok: "Верно — $150!",
    okText: "У Данияра Premium, но зачислено не $250, а $150.",
    ask: { q: "Почему от Данияра зачислено $150, а не $250?", opts: ["Это ошибка кабинета", "У Данияра самого безоплатное членство: он платит на $100 меньше, и в зачёт идёт то, что он реально оплатил", "Он оплатил с опозданием"], right: 1,
      why: "Подумай: что получает человек, у которого самого набрано $500? До $100 его взноса отменяется. Значит, и оплачивает он меньше." } },

  { view: "list", target: "sumKarim",
    text: "Найди, сколько зачислено от Карима.",
    hints: { sumMadina: "Это сумма Мадины. Ищи строку Карима.", sumDaniyar: "Это сумма Данияра. Ищи строку Карима." },
    ok: "Верно — $50!",
    okText: "Так ты видишь вклад каждого человека.",
    ask: { q: "Сложи суммы всех людей в списке. Сколько получилось?", opts: ["$550", "$450", "$500"], right: 1,
      why: "$250 + $150 + $50 = $450. Это та же цифра, что в карточке «Прямой объём по членству». Считай по колонке «Сумма», а не по плану." } },
];

/** The final check. A wrong answer takes one question back. */
export const FREE_MEMBERSHIP_QUIZ: readonly { q: string; opts: string[]; right: number }[] = [
  { q: "Безоплатное членство подтверждается за…", opts: ["а) календарный месяц", "б) твой личный месяц", "в) полгода"], right: 1 },
  { q: "Сколько прямого объёма нужно набрать за личный месяц?", opts: ["а) $100", "б) $500", "в) $600"], right: 1 },
  { q: "Где посмотреть, кто из твоих членов клуба уже оплатил и сколько зачислено?", opts: ["а) в «Командном лидерском бонусе»", "б) нажать на аватарки в карточке «Прямой объём по членству» и пролистать список вправо", "в) только спросить у наставника"], right: 1 },
  { q: "Твой член клуба на плане Premium сам получает безоплатное членство. Сколько от его оплаты зачислится в твой прямой объём?", opts: ["а) $250", "б) $150", "в) $0"], right: 1 },
  { q: "Что ты получаешь, когда набираешь $500?", opts: ["а) до $100 твоего взноса отменяется, а 200 бонусных баллов всё равно начисляются", "б) $500 на карту", "в) ранг Маркетинг директор"], right: 0 },
];

/** What to remember, shown with the results and in the material. */
export const FREE_MEMBERSHIP_SUMMARY = "Запомни главное: <b>личный месяц</b> — таймер про счёт на оплату; <b>прямой объём</b> — нажми на аватарки и пролистай список вправо; в зачёт идёт сумма, которую человек <b>реально оплатил</b>.";

/** The people of the training cabinet. */
export const FREE_MEMBERSHIP_PEOPLE = [
  { key: "Madina", initials: "МТ", name: "Мадина Т.", color: "#F59E0B", plan: "Premium", sum: "$250" },
  { key: "Daniyar", initials: "ДК", name: "Данияр К.", color: "#7C3AED", plan: "Premium", sum: "$150" },
  { key: "Karim", initials: "КС", name: "Карим С.", color: "#0EA5E9", plan: "Starter", sum: "$50" },
] as const;

/** Where a mistake happened: `m3` — mission 3, `q2` — question 2 of the check. Kept short so the site can store them. */
export function freeMembershipErrorLabel(key: string) {
  const mission = /^m([1-7])$/.exec(key);
  if (mission) return `Миссия ${mission[1]}: ${FREE_MEMBERSHIP_MISSIONS[Number(mission[1]) - 1].text}`;
  const question = /^q([1-5])$/.exec(key);
  if (question) return `Итоговая проверка: ${FREE_MEMBERSHIP_QUIZ[Number(question[1]) - 1].q}`;
  return null;
}
