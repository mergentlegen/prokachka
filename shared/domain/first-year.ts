// «Мой первый год в клубе»: a 12-month story game placed as a step inside a program.
// The "points" inside the game imitate inCruises club points; the reward on the site is miles.
export const FIRST_YEAR_KIND = "first-year";
export const FIRST_YEAR_TITLE = "Мой первый год в клубе";
export const FIRST_YEAR_DESCRIPTION = "Проживи первый год в клубе за 7 минут: 12 месяцев, 12 решений и правила, которые помогают доплыть до круиза мечты.";
export const FIRST_YEAR_REWARD = 2;
export const FIRST_YEAR_GOAL = 1500;
export const FIRST_YEAR_START_POINTS = 350;
const PAY_ON_TIME = 200, PAY_LATE = 100;

/** What a choice does to the year: pay on time or late, answer a rule question, leave the club, or only decide. */
export type FirstYearEffect = "decide" | "pay" | "late" | "fail" | "right" | "wrong";
export type FirstYearChoice = { label: string; effect: FirstYearEffect; head: string; lesson: string; autopay?: boolean; dream?: boolean };
export type FirstYearMonth = { month: number; emoji: string; title: string; quiz?: boolean; choices: FirstYearChoice[] };

export const FIRST_YEAR_MONTHS: readonly FirstYearMonth[] = [
  { month: 1, emoji: "🚀", title: "Старт", choices: [
    { label: "Подключу автоплатёж", effect: "decide", autopay: true, head: "Отличное решение!", lesson: "<b>Автоплатёж</b> — главная защита твоих удвоенных баллов. Тебе нужно только держать $100 на карте к дате счёта." },
    { label: "Буду платить сам, когда вспомню", effect: "decide", autopay: false, head: "Рискованно…", lesson: "Большинство потерь в клубе — не из-за денег, а из-за <b>забывчивости</b>. Посмотрим, что будет дальше." },
  ] },
  { month: 2, emoji: "💳", title: "Зарплата 8-го", choices: [
    { label: "Отложу $100 заранее — оплачу в первые 5 дней", effect: "pay", head: "Баллы удвоены!", lesson: "<b>Правило 5 дней:</b> оплата в течение 5 дней с даты счёта = 200 баллов. Позже = только 100." },
    { label: "Оплачу 8-го, когда придёт зарплата", effect: "late", head: "Оплачено, но без удвоения", lesson: "Ты заплатил те же $100, а получил <b>100 баллов вместо 200</b>. Совет: держи «подушку» $100 на карте к дате счёта." },
  ] },
  { month: 3, emoji: "🗣", title: "Подруга сказала…", choices: [
    { label: "Испугаюсь и отменю членство", effect: "fail", head: "Ты сошёл на берег на 3-м месяце", lesson: "Удвоенные баллы ушли в неактивный баланс — активными остались только баллы на сумму твоих взносов. А мечта снова стала «когда-нибудь». Факт: <b>пока ты платишь, баланс активный</b> — это записано в Членском соглашении." },
    { label: "Открою кабинет и проверю свой баланс", effect: "pay", head: "Баллы на месте!", lesson: "<b>Проверяй факты, а не слухи.</b> Пока ты платишь, баллы остаются на счёте и копятся дальше. Баланс становится неактивным, только если перестать платить." },
  ] },
  { month: 4, emoji: "📱", title: "Хочу новый телефон", choices: [
    { label: "Пропущу пару месяцев", effect: "fail", head: "Статус «Базовый»", lesson: "Через 30 дней без оплаты <b>удвоенные баллы уходят в неактивный баланс</b>. Доступ к ценам клуба закрывается. Чтобы вернуться — снова полный первый взнос <b>$200</b>. Телефон обошёлся дороже, чем казалось." },
    { label: "Остаюсь в клубе, телефон подождёт", effect: "pay", head: "Курс держишь!", lesson: "Один пропуск стоит дороже, чем кажется: <b>удвоение</b> уходит в неактивный баланс, а возвращение = снова $200." },
  ] },
  { month: 5, emoji: "😴", title: "Скучно…", choices: [
    { label: "Открою каталог и выберу свой маршрут", effect: "pay", dream: true, head: "Мечта стала реальной", lesson: "Когда у мечты есть <b>картинка, цена и дата</b> — её не бросают. Поставь фото круиза на заставку телефона." },
    { label: "Просто продолжу платить", effect: "pay", head: "Платёж прошёл", lesson: "Хорошо, но без цели перед глазами легко сдаться. Открой каталог — <b>выбери свой круиз</b>." },
  ] },
  { month: 6, emoji: "🔧", title: "Неожиданный ремонт", choices: [
    { label: "Оплачу взнос вовремя, ремонт растяну", effect: "pay", head: "Ты прошёл самый трудный месяц!", lesson: "Трудности бывают у всех. Выигрывает тот, кто <b>не обнуляет</b> накопленное в трудный момент." },
    { label: "Оплачу взнос на 20-й день", effect: "late", head: "Членство сохранено", lesson: "Ты не потерял накопленное — это главное. Но в этом месяце <b>только 100 баллов</b>." },
    { label: "Поставлю членство на паузу", effect: "fail", head: "Ты сошёл на берег на 6-м месяце", lesson: "После 30 дней без оплаты удвоенные баллы ушли в неактивный баланс. Полгода накоплений превратились в половину. Иногда лучше <b>заплатить позже, но не уходить</b>." },
  ] },
  { month: 7, emoji: "🎯", title: "Выбираем круиз", quiz: true, choices: [
    { label: "Да, конечно", effect: "wrong", head: "❌ Не совсем", lesson: "С баллами круиз бронируют <b>минимум за 90 дней</b> до отплытия. Выбирай рейс через 4 месяца и дальше." },
    { label: "Нет — нужно бронировать минимум за 90 дней", effect: "right", head: "✅ Верно!", lesson: "С баллами круиз бронируют <b>минимум за 90 дней</b> до отплытия. Планируй заранее!" },
  ] },
  { month: 8, emoji: "🧮", title: "Сколько баллов спишется?", quiz: true, choices: [
    { label: "3 000 — всю цену", effect: "wrong", head: "❌ Не совсем", lesson: "Баллами можно оплатить <b>до 50%</b> цены круиза. Здесь — 1 500 баллов + $1 500 своих." },
    { label: "1 500 — половину", effect: "right", head: "✅ Верно!", lesson: "Верно! <b>До 50%</b> цены — баллами. 1 500 баллов + $1 500 своих." },
    { label: "Сколько есть на счёте", effect: "wrong", head: "❌ Не совсем", lesson: "Не всё сразу: баллами можно оплатить <b>до 50%</b> цены круиза — здесь 1 500." },
  ] },
  { month: 9, emoji: "🛑", title: "Круиз забронирован!", quiz: true, choices: [
    { label: "Да, круиз уже мой", effect: "wrong", head: "❌ Не совсем", lesson: "Опасная ошибка! Член клуба CLASSIC должен оставаться <b>активным до посадки</b> на лайнер. Иначе бронь могут аннулировать, а свои деньги не вернут." },
    { label: "Нет — платить нужно до посадки на лайнер", effect: "right", head: "✅ Верно!", lesson: "Верно! Членство должно быть <b>активным до посадки</b>, иначе бронь могут аннулировать." },
  ] },
  { month: 10, emoji: "🛳", title: "Отплытие!", quiz: true, choices: [
    { label: "Каюта, портовые сборы и налоги", effect: "right", head: "✅ Верно!", lesson: "Верно! А перелёт, напитки, экскурсии и чаевые оплачиваются отдельно — <b>заложи их в бюджет заранее</b>." },
    { label: "Перелёт и экскурсии", effect: "wrong", head: "❌ Не совсем", lesson: "Баллы идут на <b>каюту, портовые сборы и налоги</b>. Перелёт, напитки, экскурсии и чаевые — отдельно." },
    { label: "Вообще всё", effect: "wrong", head: "❌ Не совсем", lesson: "Баллы идут на <b>каюту, портовые сборы и налоги</b>. Перелёт, напитки, экскурсии и чаевые — отдельно." },
  ] },
  { month: 11, emoji: "🌅", title: "Ты вернулся", choices: [
    { label: "Копить на следующий круиз!", effect: "pay", head: "Новый курс взят", lesson: "Первый круиз — самый трудный. Дальше ты уже знаешь: <b>это работает</b>." },
    { label: "Позову с собой близких в следующий раз", effect: "pay", head: "Путешествовать вместе — веселее", lesson: "Цена круиза указана за человека в двухместной каюте. <b>Вдвоём — выгоднее</b>, а близкие копят в своём клубе." },
  ] },
  { month: 12, emoji: "🏁", title: "Последний месяц года", choices: [
    { label: "Оплатить вовремя", effect: "pay", head: "Год завершён!", lesson: "Посмотрим на итоги." },
  ] },
];

export const FIRST_YEAR_MOTIVATION: Record<number, [string, string]> = {
  2: ["🧠", "+200 баллов. Но главное не цифра. Сегодня ты сделал то, что делают все, кто достигает: ты отложил на мечту, а не потратил на «сейчас»."],
  3: ["🌊", "Пока ты нажимал «оплатить», кто-то из клуба поднялся на борт. Сейчас он стоит на палубе с кофе, смотрит на море и передаёт тебе привет. Скоро твоя очередь."],
  4: ["🧠", "Знаешь, что ты сейчас копишь на самом деле? Не только баллы. Ты копишь привычку. А привычка — это то, что работает без мотивации."],
  5: ["⚓", "Прямо сейчас где-то в Средиземном море лайнер заходит в порт, и на нём люди, которые полгода назад были на твоём месте. Они тоже сомневались и тоже копили. И доплыли."],
  6: ["💪", "Полгода вовремя. Так формируется характер человека, который доводит до конца. Эта привычка не останется в клубе: она придёт в твои деньги, в твой бизнес и в каждую твою цель."],
  7: ["📸", "Каждый день кто-то из клуба поднимается на борт. Сегодня это кто-то другой. Скоро на фото с палубы будешь ты."],
  8: ["🧠", "Люди, которые умеют копить на мечту, умеют копить на всё: на дом, на учёбу детям, на свободу. Ты тренируешься прямо сейчас."],
  9: ["🗺", "По всему миру члены клуба сейчас гуляют по Барселоне, встречают закат в Греции и плывут по Дунаю. Ты уже не «мечтаешь», ты «в пути»."],
  10: ["🏆", "Ты едешь в круиз не потому, что тебе повезло, а потому, что ты 10 месяцев держал слово самому себе. Это сильнее любого везения."],
  11: ["☀️", "С борта пришёл привет: «Держи курс, здесь всё так, как ты представлял. Даже лучше»."],
  12: ["🎉", "Год. 12 раз ты выбрал мечту. Круиз — это награда, а привычка — это капитал, который останется с тобой навсегда."],
};

/** Choices that end the year early; the server never accepts them in a finished game. */
export function firstYearAllowed(month: number) {
  return FIRST_YEAR_MONTHS[month - 1]?.choices.map((choice, index) => choice.effect === "fail" ? -1 : index).filter((index) => index >= 0) || [];
}

export type FirstYearState = { points: number; autopay: boolean; late: number; correct: number; quizzes: number; goalMonth: number | null; marks: Record<number, "done" | "late">; dream: boolean };

/** Replays the saved choices: the same arithmetic as the original game, so a resumed year shows the same score. */
export function replayFirstYear(choices: number[]): FirstYearState {
  const state: FirstYearState = { points: FIRST_YEAR_START_POINTS, autopay: false, late: 0, correct: 0, quizzes: 0, goalMonth: null, marks: { 1: "done" }, dream: false };
  choices.forEach((index, position) => applyFirstYear(state, position + 1, index));
  return state;
}

export function applyFirstYear(state: FirstYearState, month: number, index: number) {
  const choice = FIRST_YEAR_MONTHS[month - 1]?.choices[index];
  if (!choice) return { delta: 0, choice: undefined };
  if (choice.autopay !== undefined) state.autopay = choice.autopay;
  if (choice.dream) state.dream = true;
  let delta = 0;
  if (choice.effect === "pay" || choice.effect === "right" || choice.effect === "wrong") delta = PAY_ON_TIME;
  if (choice.effect === "late") { delta = PAY_LATE; state.late += 1; }
  if (choice.effect === "right" || choice.effect === "wrong") { state.quizzes += 1; if (choice.effect === "right") state.correct += 1; }
  if (delta) {
    state.points += delta;
    state.marks[month] = choice.effect === "late" ? "late" : "done";
    if (state.goalMonth === null && state.points >= FIRST_YEAR_GOAL) state.goalMonth = month;
  }
  return { delta, choice };
}
