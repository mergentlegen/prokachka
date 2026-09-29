"use client";

import { useEffect, useRef, useState } from "react";
import type { Submission } from "@/shared/domain/types";
import { DREAM_ROUTE_CARDS, DREAM_ROUTE_QUESTIONS, DREAM_ROUTE_REWARD, DREAM_ROUTE_STATIONS } from "@/shared/domain/dream-route";
import { dreamRouteAction } from "@/frontend/shared/api/dream-route-client";
import { createCompanyVoiceLink } from "@/frontend/shared/api/ready-program-client";
import { ApiError, createTelegramLink } from "@/frontend/shared/api/client";
import styles from "./DreamRouteGame.module.css";

type Form = {
  study: boolean[]; studyTime: "" | "по утрам" | "днём" | "по вечерам";
  dream: string; sum: string; currency: "₸" | "$"; hook: string;
  gameAnswers: number[]; flipOpen: boolean; openStations: number[]; quizAnswers: number[];
  station: string; names: string[];
};
const initial: Form = { study: [false, false], studyTime: "", dream: "", sum: "", currency: "₸", hook: "", gameAnswers: [], flipOpen: false, openStations: [], quizAnswers: [], station: "", names: ["", "", ""] };
const studyTimes = [["🌅 Утро", "по утрам"], ["☀️ День", "днём"], ["🌙 Вечер", "по вечерам"]] as const;
const hookOptions = ["💰 Найду деньги на старт", "📦 Придумаю продукт", "🏢 Найду помещение", "🤷 Не знаю"];

function restore(raw: Record<string, unknown>): Form {
  const names = Array.isArray(raw.names) ? raw.names : [];
  return {
    ...initial, ...raw,
    study: Array.isArray(raw.study) ? [raw.study[0] === true, raw.study[1] === true] : initial.study,
    studyTime: studyTimes.some(([, time]) => time === raw.studyTime) ? raw.studyTime as Form["studyTime"] : "",
    dream: typeof raw.dream === "string" ? raw.dream : "", sum: raw.sum == null ? "" : String(raw.sum),
    currency: raw.currency === "$" ? "$" : "₸", hook: typeof raw.hook === "string" ? raw.hook : "",
    gameAnswers: Array.isArray(raw.gameAnswers) ? raw.gameAnswers.filter((x) => x === 0 || x === 1).slice(0, 7) : [],
    flipOpen: raw.flipOpen === true,
    openStations: Array.isArray(raw.openStations) ? raw.openStations.filter((x) => Number.isInteger(x) && x >= 0 && x < 4) : [],
    quizAnswers: Array.isArray(raw.quizAnswers) ? raw.quizAnswers.filter((x) => Number.isInteger(x) && x >= 0 && x < 3).slice(0, 5) : [],
    station: typeof raw.station === "string" ? raw.station : "",
    names: [0, 1, 2].map((i) => typeof names[i] === "string" ? names[i] : ""),
  };
}
function payload(form: Form) { return { ...form, dream: form.dream.trim(), sum: Number(form.sum), names: form.names.map((name) => name.trim()) }; }
function validSum(sum: string) { return /^\d+(?:\.\d{1,2})?$/.test(sum) && Number(sum) >= 1 && Number(sum) <= 1e12; }

export function DreamRouteGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const [form, setForm] = useState<Form>(initial), [step, setStep] = useState(0), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [gameIndex, setGameIndex] = useState(0), [quizIndex, setQuizIndex] = useState(0);
  const [completed, setCompleted] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [linkRequired, setLinkRequired] = useState(false), [highlightMe, setHighlightMe] = useState(false);
  const inFlight = useRef(false), version = useRef(0), content = useRef<HTMLElement>(null);
  const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ${form.currency}`;
  const voice = `Моя мечта — ${form.dream}, она стоит ${money(Number(form.sum))}. Я понял(а), что inCruises предлагает готовую систему: в учебном примере партнёрство стоит $95 на полгода, а обучение помогает пройти игра. Я выделил(а) время на обучение ${form.studyTime}. Моя первая станция — ${form.station}. Первые 3 человека, которым я расскажу о клубе: ${form.names.join(", ")}.`;

  function update<K extends keyof Form>(key: K, value: Form[K]) { setForm((old) => ({ ...old, [key]: value })); setError(""); }
  useEffect(() => {
    const current = ++version.current;
    void dreamRouteAction(taskId, "start").then((saved) => {
      if (version.current !== current) return;
      const restored = restore(saved.answers);
      setForm(restored); setStep(saved.step); setCompleted(saved.completed);
      setGameIndex(Math.min(restored.gameAnswers.length, 6)); setQuizIndex(Math.min(restored.quizAnswers.length, 4)); setLoading(false);
    }).catch((cause) => { if (version.current === current) { setError(cause instanceof Error ? cause.message : "Не удалось открыть маршрут."); setLoading(false); } });
    return () => { version.current = current + 1; };
  }, [taskId]);
  useEffect(() => { content.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "instant" }); content.current?.focus({ preventScroll: true }); }, [step]);

  async function save(next: number, nextForm = form) {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await dreamRouteAction(taskId, "save", next, payload(nextForm));
      setForm(nextForm); setStep(result.step); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить прогресс. Попробуйте ещё раз."); return false; }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function finish() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await dreamRouteAction(taskId, "complete");
      if (!result.completed || !result.submission) throw new Error("Не удалось подтвердить начисление. Попробуйте ещё раз.");
      setCompleted(true); setStep(12); onCompleted?.(result.submission);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось завершить маршрут."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function telegram() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (linkRequired) {
        const linked = await createTelegramLink();
        if (linked.url) { window.location.assign(linked.url); return; }
        if (!linked.linked) throw new Error("Не удалось привязать Telegram.");
        setLinkRequired(false);
      }
      const { url } = await createCompanyVoiceLink(taskId);
      const target = new URL(url);
      if (target.protocol !== "https:" || target.hostname !== "t.me") throw new Error("Некорректная ссылка Telegram.");
      setNotice("В Telegram нажми «Начать» и запиши голосовое в чате бота.");
      window.location.assign(target.href);
    } catch (cause) { if (cause instanceof ApiError && cause.status === 422) setLinkRequired(true); setError(cause instanceof Error ? cause.message : "Не удалось открыть Telegram."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const next = (label: string, target: number, disabled = false) => <button type="button" className={styles.primary} disabled={busy || disabled} onClick={() => void save(target)}>{busy ? "Сохраняем…" : label}</button>;
  const select = (value: string, selected: string, onClick: () => void, extra = "") => <button type="button" key={value} className={`${styles.option} ${selected === value ? styles.selected : ""} ${extra}`} aria-pressed={selected === value} onClick={onClick}>{value}</button>;
  const card = DREAM_ROUTE_CARDS[gameIndex], gameAnswer = form.gameAnswers[gameIndex];
  const question = DREAM_ROUTE_QUESTIONS[quizIndex], quizAnswer = form.quizAnswers[quizIndex];

  return <section className={styles.game} aria-label="Игра Мечта — маршрут" ref={content} tabIndex={-1}>
    <div className={styles.wrap}><header className={styles.top}><strong>Старт новичка · Мечта → маршрут</strong><span className={styles.miles}>✈️ {completed ? DREAM_ROUTE_REWARD : 0} миль</span></header>
    <div className={styles.bar} role="progressbar" aria-label="Прогресс маршрута" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(step / 12 * 100)}><i style={{ width: `${step / 12 * 100}%` }}/></div>
    <article className={styles.card}>
      {loading ? <p role="status">Загружаем маршрут…</p> : <>
      {step > 0 && step < 12 && <button type="button" className={styles.back} disabled={busy} onClick={() => setStep((value) => value - 1)}>← Назад</button>}
      {step === 0 && <><span className={styles.kicker}>Блок · Мечта → маршрут</span><div className={styles.big}>🧭</div><h1>Мы обещали показать тебе путь?! Держим слово</h1><p>В прошлом блоке ты увидел вторую дорогу. Сейчас мы покажем, куда она ведёт и как по ней идти.</p><p>Путь уже построен: компания подготовила бизнес-модель, а наша команда — систему обучения.</p><p><b>За тобой остаётся совсем немного.</b> Всего три вещи — но от них зависит всё.</p><h2>Моя часть пути</h2>
        {["📚 Изучать|Проходить каждый блок до конца, не пропуская", "🙋 Задавать вопросы наставнику|Любые, даже если кажутся простыми. Глупых вопросов здесь нет"].map((item, index) => { const [title, detail] = item.split("|"); return <button type="button" key={title} className={`${styles.check} ${form.study[index] ? styles.checked : ""}`} aria-pressed={form.study[index]} onClick={() => update("study", form.study.map((value, i) => i === index ? !value : value))}><span>{form.study[index] ? "✓" : ""}</span><span><b>{title}</b>{detail}</span></button>; })}
        <div className={styles.check}><span>{form.studyTime ? "✓" : ""}</span><span><b>⏰ Выделить время</b>Выбери своё постоянное время для обучения:<span className={styles.timeChoices}>{studyTimes.map(([label, time]) => <button type="button" key={time} className={form.studyTime === time ? styles.selected : ""} aria-pressed={form.studyTime === time} onClick={() => update("studyTime", time)}>{label}</button>)}</span></span></div>
        {form.study.every(Boolean) && form.studyTime && <div className={styles.deal}>🤝 Договорились! Ты делаешь свою часть, а мы свою. Всё остальное уже готово.</div>}
        {next("Показывай путь →", 1, !form.study.every(Boolean) || !form.studyTime)}</>}
      {step === 1 && <><span className={styles.kicker}>Ради чего мы идём</span><div className={styles.big}>🌟</div><h1>Напомни свою мечту</h1><p>Прежде чем смотреть на путь, напомни свою мечту — к ней он и ведёт.</p><label>Моя мечта<input maxLength={120} value={form.dream} onChange={(event) => update("dream", event.target.value)} placeholder="Например, дом для семьи" /></label><label>Сколько она стоит<input type="number" inputMode="decimal" min="1" max="1000000000000" value={form.sum} onChange={(event) => update("sum", event.target.value)} placeholder="Только число" /></label><div className={`${styles.options} ${styles.two}`}>{(["₸", "$"] as const).map((currency) => <button type="button" key={currency} className={`${styles.option} ${form.currency === currency ? styles.selected : ""}`} aria-pressed={form.currency === currency} onClick={() => update("currency", currency)}>{currency === "₸" ? "₸ тенге" : "$ доллары"}</button>)}</div>{next("Дальше", 2, !form.dream.trim() || !validSum(form.sum))}</>}
      {step === 2 && <><span className={styles.kicker}>Как начать зарабатывать</span><h1>Твоя мечта стоит {money(Number(form.sum))}. А вход на эту дорогу — $95</h1><p>Первый шаг на пути — стать <b>партнёром inCruises</b>.</p><p>Сейчас ты член клуба: путешествуешь выгоднее и копишь бонусы. Партнёрство открывает возможность получать вознаграждение за продажи клубного продукта и развивать команду. Само приглашение человека без покупки клубного плана не оплачивается.</p><p>В исходном учебном материале указано <b>$95 на полгода</b> — и при входе, и при продлении. Перед оплатой проверь актуальные условия в кабинете inCruises.</p><div className={styles.price}><div><small>Твоя мечта</small><b>{money(Number(form.sum))}</b></div><div><small>Вход в бизнес</small><b>$95</b><small>на полгода · учебный пример</small></div></div><p>Как быстро ты придёшь к мечте — зависит от твоих действий. А теперь посмотрим, почему это не обычный бизнес.</p>{next("Почему это не обычный бизнес? →", 3)}</>}
      {step === 3 && <><span className={styles.kicker}>Представь</span><h2>Ты решил открыть свой бизнес, чтобы заработать на мечту. С чего начнёшь?</h2><div className={styles.options}>{hookOptions.map((option) => select(option, form.hook, () => update("hook", option)))}</div>{form.hook && <p className={styles.tip}>Хороший старт. Давай посмотрим, что тебя ждёт, если строить всё с нуля, — и сравним с готовым бизнесом.</p>}{next("Сравнить →", 4, !form.hook)}</>}
      {step === 4 && <><span className={styles.kicker}>Игра · С нуля или готовый?</span><p className={styles.count}>Карточка {gameIndex + 1} из {DREAM_ROUTE_CARDS.length}</p><div className={styles.gameCard}><div className={styles.big}>{card.icon}</div><h2>{card.title}</h2><p>{card.question}</p><div className={`${styles.options} ${styles.two}`}>{[1, 0].map((answer) => <button type="button" key={answer} disabled={busy || gameAnswer !== undefined} className={`${styles.option} ${gameAnswer === answer ? card.ready !== null && answer === 1 ? styles.wrong : styles.right : ""}`} onClick={() => { const answers = [...form.gameAnswers]; answers[gameIndex] = answer; void save(4, { ...form, gameAnswers: answers }); }}>{answer ? "Да, нужно" : "Нет, уже готово"}</button>)}</div>{gameAnswer !== undefined && <><p className={`${styles.feedback} ${gameAnswer === 1 && card.ready !== null ? styles.bad : styles.good}`}>{card.ready === null ? "🔒 Ответ на эту карточку — на следующем экране" : gameAnswer === 1 ? "А вот и нет — в готовом бизнесе это не нужно" : "Верно!"}</p><div className={styles.compare}><div><small>С нуля</small>{card.fromZero}</div><div><small>inCruises</small>{card.ready || "❓ Скоро узнаешь"}</div></div>{gameIndex < DREAM_ROUTE_CARDS.length - 1 ? <button type="button" className={styles.primary} onClick={() => setGameIndex((value) => value + 1)}>Следующая карточка →</button> : <>{next("Что ещё готово? →", 5)}</>}</>}</div><div className={styles.tally}>{form.gameAnswers.map((_, index) => <span key={index}>{DREAM_ROUTE_CARDS[index].icon} {index === 6 ? "❓" : "✅"}</span>)}</div></>}
      {step === 5 && <><span className={styles.kicker}>Готовый бизнес</span><h2>Всё самое сложное уже сделано за тебя</h2><p>В inCruises не нужно строить бизнес с нуля. Компания уже подготовила:</p><ul className={styles.ready}><li>🤝 <b>Договоры с поставщиками</b> — компания работает с круизными линиями.</li><li>⚖️ <b>Юридические документы</b> — договоры клуба и партнёра.</li><li>💲 <b>Клубные цены</b> — условия для членов клуба.</li><li>🌍 <b>Широкую аудиторию</b> — людей, которым интересны путешествия.</li><li>🚀 <b>Нишу для развития</b> — многие ещё не были в круизе.</li></ul><p>А наша команда приготовила для тебя ещё одно. Помнишь закрытую карточку?</p><button type="button" className={`${styles.flip} ${form.flipOpen ? styles.flipped : ""}`} aria-expanded={form.flipOpen} onClick={() => { if (!form.flipOpen) void save(5, { ...form, flipOpen: true }); }}><span>🎓</span><b>{form.flipOpen ? "Обучение" : "Обучение — нажми, чтобы открыть"}</b>{form.flipOpen && <span>Готово: игра «Старт новичка» от нашей команды. Она обучает нового человека по шагам, а ты подключаешься как наставник в важные моменты.</span>}</button>{next("Как это работает для меня? →", 6, !form.flipOpen)}</>}
      {step === 6 && <><span className={styles.kicker}>Как растёт твоя команда</span><h2>Ты не учишь каждого с нуля</h2><ol className={styles.chain}>{["👤 Ты пригласил", "🎫 Человек стал членом клуба", "🎮 Ты позвал его в игру", "🎓 Игра его обучила", "👥 Он пригласил своего", "🎓 Игра обучила и его"].map((text, index) => <li key={text} className={index === 0 && highlightMe ? styles.me : ""}>{text}</li>)}</ol><div className={styles.tree}><div>ТЫ</div><div>🎓　🎓</div><div>🎓　🎓　🎓　🎓</div><small>🎓 — каждого обучает игра, а не ты лично</small></div><p className={styles.caption}>Ты не учишь каждого с нуля. Ты передаёшь систему, и система учит дальше.</p><button type="button" className={styles.secondary} onClick={() => setHighlightMe(true)}>📍 Покажи, где здесь я</button>{highlightMe && <p className={styles.center}><b>Твоё звено — первое.</b> Всё остальное запускается отсюда.</p>}{next("Дальше →", 7)}</>}
      {step === 7 && <><span className={styles.kicker}>Запомни формулу</span><h2>Твоя работа — три шага</h2><div className={styles.formula}><div>1. Пригласил</div><span>↓</span><div>2. Зарегистрировал</div><span>↓</span><div>3. Позвал в игру</div></div><p className={styles.center}>Остальному научит система. У твоего партнёра будет всё, чтобы начать, а действовать или нет — решает он сам.</p>{next("Покажи мой маршрут →", 8)}</>}
      {step === 8 && <><span className={styles.kicker}>Карта маршрута</span><h2>4 станции от мечты</h2><p>Открой каждую станцию. Числа приведены как учебный пример; актуальные условия проверь в личном кабинете inCruises.</p>{[
        ["🏝 Моё членство окупается", "Знакомые тоже становятся членами клуба.", "В учебном примере при $500 прямого оборота за период членства может быть отменено до $100 месячного взноса; условия проверяются на момент выставления счёта."],
        ["💵 Первый доход", "Ты приглашаешь человека, и он активирует план.", "В исходном материале бонусы: STARTER $20 · CLASSIC $20 · PREMIUM $50. Проверь актуальные тарифы и сроки выплат."],
        ["🚀 Первый ранг — Marketing Director", "У тебя появляется небольшая команда.", "Учебный пример: $3 000 квалифицированного оборота и $600 активационного объёма → бонус до $300. При выполнении условий быстрого старта — разовый бонус до $500 вместо $300."],
        ["📈 Доход растёт вместе с командой", "Команда повторяет то, что сделал ты.", "Учебный пример: рекуррентное вознаграждение от $5 за каждые $100 квалифицированного объёма. Дальше — ранги до Board of Directors."],
      ].map(([title, body, fact], index) => <div key={title} className={`${styles.station} ${form.openStations.includes(index) ? styles.stationOpen : ""}`}><button type="button" aria-expanded={form.openStations.includes(index)} onClick={() => update("openStations", form.openStations.includes(index) ? form.openStations.filter((n) => n !== index) : [...form.openStations, index])}><span>{index + 1}</span>{title}</button>{form.openStations.includes(index) && <div className={styles.stationBody}>{body}<div>{fact}</div>{index === 3 && <table><thead><tr><th>Ранг</th><th>Товарооборот</th><th>Лидерский бонус до</th></tr></thead><tbody>{[["Marketing Director", "$3 000", "$300"], ["Senior Marketing Director", "$10 000", "$1 000"], ["Regional Director", "$25 000", "$2 500"], ["National Director", "$50 000", "$5 000"], ["International Director", "$100 000", "$10 000"]].map(([rank, volume, bonus]) => <tr key={rank}><td>{rank}</td><td>{volume}</td><td>{bonus}</td></tr>)}</tbody></table>}</div>}</div>)}<div className={styles.result}><small>Твоя мечта: {form.dream}</small><small>Чтобы собрать такую сумму за 5 лет, нужно в месяц</small><b>{money(Number(form.sum) / 60)}</b></div><p className={styles.center}>Посмотри на станции и ранги: где примерно лежит твоя цифра?</p><p className={styles.disclaimer}>Доход не гарантирован и зависит от продаж и усилий команды. Размеры и условия вознаграждений могут меняться. <a href="https://www.incruises.com/disclosure" target="_blank" rel="noopener noreferrer">Официальное раскрытие доходов ↗</a></p>{next("Проверь себя →", 9)}</>}
      {step === 9 && <><span className={styles.kicker}>Квиз · вопрос {quizIndex + 1} из {DREAM_ROUTE_QUESTIONS.length}</span><h2>{question.question}</h2><div className={styles.options}>{question.options.map((option, index) => <button type="button" key={option} disabled={busy || quizAnswer !== undefined} className={`${styles.option} ${quizAnswer !== undefined && index === question.answer ? styles.right : ""} ${quizAnswer === index && index !== question.answer ? styles.wrong : ""}`} onClick={() => { const answers = [...form.quizAnswers]; answers[quizIndex] = index; void save(9, { ...form, quizAnswers: answers }); }}>{option}</button>)}</div>{quizAnswer !== undefined && <><p className={`${styles.feedback} ${quizAnswer === question.answer ? styles.good : styles.bad}`}>{quizAnswer === question.answer ? "Верно!" : "Не совсем."} {question.explanation}</p>{quizIndex < DREAM_ROUTE_QUESTIONS.length - 1 ? <button type="button" className={styles.primary} onClick={() => setQuizIndex((value) => value + 1)}>Дальше</button> : next("Дальше", 10)}</>}</>}
      {step === 10 && <><span className={styles.kicker}>Задание · Сделай</span><h2>Выбери свою первую станцию</h2><div className={styles.options}>{DREAM_ROUTE_STATIONS.map((station) => select(station, form.station, () => update("station", station)))}</div><label>Первые 3 человека, которым я расскажу о клубе{form.names.map((name, index) => <input key={index} maxLength={80} value={name} onChange={(event) => update("names", form.names.map((value, i) => i === index ? event.target.value : value))} placeholder={`Имя ${index + 1}`} />)}</label>{next("Готово →", 11, !form.station || form.names.some((name) => !name.trim()))}</>}
      {step === 11 && <><span className={styles.kicker}>Задание · Отправь наставнику</span><div className={styles.big}>🎙</div><h2>Запиши голосовое наставнику — 1 минута</h2><p>Скажи своими словами. Можно опираться на это:</p><blockquote className={styles.quote}>{voice}</blockquote><button type="button" className={styles.primary} disabled={busy} onClick={() => void finish()}>{busy ? "Завершаем…" : "Завершить маршрут · +10 миль"}</button><p className={styles.hint}>После начисления откроется Telegram. Ответ наставника не нужен для 10 миль.</p></>}
      {step === 12 && <><span className={styles.kicker}>Следующий шаг</span><h2>Ты знаешь свою мечту и свой маршрут</h2><div className={styles.reward}>+10 миль начислены</div><p>Расскажи наставнику о своём плане. Голосовое получат наставники выше тебя по ветке, у которых есть право проверки.</p><blockquote className={styles.quote}>{voice}</blockquote><button type="button" className={styles.primary} disabled={busy} onClick={() => void telegram()}>{busy ? "Открываем Telegram…" : "🎙 Записать голосовое наставнику"}</button><p className={styles.hint}>В Telegram нажми «Начать» и отправь одно голосовое через микрофон бота. Повторных миль за него нет. Следующие задания открой во вкладке «Задания».</p></>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}{error && <div role="alert" className={styles.error}>{error}{step === 0 && <button type="button" onClick={() => { setLoading(true); setError(""); void dreamRouteAction(taskId, "start").then((saved) => { setForm(restore(saved.answers)); setStep(saved.step); setLoading(false); }).catch((cause) => { setError(cause instanceof Error ? cause.message : "Не удалось открыть маршрут."); setLoading(false); }); }}>Повторить</button>}</div>}
      </>}
    </article></div>
  </section>;
}
