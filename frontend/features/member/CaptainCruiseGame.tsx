"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CAPTAIN_CRUISE_TITLE, CAPTAIN_STAGES, CRUISE_CABINS, CRUISE_CARD_ROWS, CRUISE_DIRECTIONS, CRUISE_LINES, CRUISE_PORTS, captainMessage, type CaptainCruiseDetails } from "@/shared/domain/captain-cruise";
import { captainAction, captainTelegramLink, type CaptainAttempt } from "@/frontend/shared/api/captain-cruise-client";
import { ApiError, createTelegramLink } from "@/frontend/shared/api/client";
import type { Submission } from "@/shared/domain/types";
import styles from "./CaptainCruiseGame.module.css";

type Screen = "intro" | "home" | "search" | "lines" | "dest" | "card" | "cruise" | "guests" | "cabin" | "twist";
const ROUTE: Screen[] = ["intro", "home", "search", "card", "cruise", "guests", "cabin", "twist"];
const CRUISE_TITLE = "7 Nights Western Mediterranean From Civitavecchia (Rome)";
const GUEST_LABELS = [["Взрослые", "18–54 лет"], ["Дети и подростки", "0–17 лет"], ["Пожилые", "55+ лет"]] as const;
function initialView(index: number): { screen: Screen; quiz: number | null } {
  if (index === 0) return { screen: "intro", quiz: null };
  if (index <= 6) return { screen: index === 3 || index === 4 ? "lines" : "search", quiz: [1, 3, 4].includes(index) ? index : null };
  if (index <= 8) return { screen: "card", quiz: index };
  if (index <= 10) return { screen: "cruise", quiz: null };
  if (index <= 12) return { screen: "guests", quiz: index === 12 ? index : null };
  if (index <= 14) return { screen: "cabin", quiz: index === 13 ? index : null };
  return { screen: "twist", quiz: null };
}
function family(guests: number[]) {
  const plural = (n: number, one: string, few: string, many: string) => n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
  return guests.map((n, i) => !n ? "" : i === 0 ? `${n} ${plural(n, "взрослый", "взрослых", "взрослых")}` : i === 1 ? `${n} ${plural(n, "ребёнок", "ребёнка", "детей")}` : `${n} ${plural(n, "гость", "гостя", "гостей")} 55+`).filter(Boolean).join(", ") || "—";
}

export function CaptainCruiseGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const [attempt, setAttempt] = useState<CaptainAttempt | null>(null);
  const [screen, setScreen] = useState<Screen>("intro");
  const [quizIndex, setQuizIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [readKeys, setReadKeys] = useState<string[]>([]);
  const [readCabins, setReadCabins] = useState<number[]>([]);
  const [guests, setGuests] = useState([2, 0, 0]);
  const [direction, setDirection] = useState("");
  const [filter, setFilter] = useState("");
  const [details, setDetails] = useState<CaptainCruiseDetails>({ direction: "", line: "", who: "", price: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState("");
  const [linkRequired, setLinkRequired] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const inFlight = useRef(false), version = useRef(0);
  const content = useRef<HTMLDivElement>(null), sheet = useRef<HTMLDivElement>(null);
  const id = useId();
  const index = attempt?.index ?? 0;
  const phase = index < 5 ? 1 : index === 5 ? 2 : 3;
  const stage = quizIndex === null ? null : CAPTAIN_STAGES[quizIndex];
  const detailsReady = Object.values(details).every((value) => value.trim().length > 0 && value.length <= 120);

  useEffect(() => {
    const current = ++version.current;
    void captainAction(taskId, "start").then((saved) => {
      if (current !== version.current) return;
      const view = initialView(saved.index);
      setAttempt(saved); setScreen(view.screen); setQuizIndex(saved.failed ? saved.index : view.quiz);
      setSelected(saved.failed ? saved.lastAnswer ?? null : null); setFeedback(saved.failed ? "incorrect" : "");
      // These reading prerequisites have already been checked by the server.
      setReadKeys(saved.index >= 7 ? CRUISE_CARD_ROWS.map(([key]) => key) : []);
      setReadCabins(saved.index >= 10 || (saved.index === 9 && saved.failed) ? [0, 1, 2, 3] : []);
      setDirection(saved.direction || ""); setGuests(saved.guests || [2, 0, 0]);
      setDetails(saved.details || { direction: saved.direction || "Средиземное море", line: "", who: family(saved.guests || [2, 0, 0]), price: "" });
      setError("");
    }).catch((cause) => { if (current === version.current) setError(cause instanceof Error ? cause.message : "Не удалось загрузить тренировку."); });
    return () => { version.current = current + 1; };
  }, [taskId, loadKey]);
  useEffect(() => {
    content.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "instant" });
    content.current?.focus({ preventScroll: true });
  }, [screen]);
  useEffect(() => { if (quizIndex !== null) sheet.current?.focus({ preventScroll: true }); }, [quizIndex]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (screen !== "cruise" || index !== 9 || readCabins.length !== 4 || quizIndex !== null) return;
    // Same short pause as the HTML: show the last cabin's hint before the question.
    const timer = setTimeout(() => { setQuizIndex(9); setSelected(null); setFeedback(""); setError(""); setToast(""); }, 900);
    return () => clearTimeout(timer);
  }, [screen, index, readCabins.length, quizIndex]);

  async function run(action: () => Promise<CaptainAttempt>, success?: (saved: CaptainAttempt) => void) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    const current = version.current;
    try { const saved = await action(); if (current === version.current) { setAttempt(saved); success?.(saved); } }
    catch (cause) { if (current === version.current) setError(cause instanceof Error ? cause.message : "Не удалось сохранить прогресс. Повтори попытку."); }
    finally { inFlight.current = false; if (current === version.current) setBusy(false); }
  }
  function showQuiz(step: number) { setQuizIndex(step); setSelected(null); setFeedback(""); setError(""); setToast(""); }
  function answer(value: number) {
    if (quizIndex === null || feedback || inFlight.current) return;
    setSelected(value);
    void run(() => captainAction(taskId, "checkpoint", quizIndex, { answer: value, ...(quizIndex === 9 ? { readCabins } : {}), ...(quizIndex === 11 ? { guests } : {}) }), (saved) => setFeedback(saved.failed ? "incorrect" : "correct"));
  }
  function nextQuiz() {
    if (feedback !== "correct" || busy || quizIndex === null) return;
    const previous = quizIndex;
    setQuizIndex(null); setFeedback(""); setSelected(null); setError("");
    if ([2, 3, 7, 11].includes(previous)) showQuiz(previous + 1);
    else if (previous === 4) setScreen("search");
    else if (previous === 8) setScreen("cruise");
    else if (previous === 12) { setDetails((old) => ({ ...old, who: family(guests) })); setScreen("cabin"); showQuiz(13); }
    else content.current?.focus({ preventScroll: true });
  }
  function pickDirection(value: string) {
    if (index === 5) void run(() => captainAction(taskId, "checkpoint", 5, { direction: value }), () => { setDirection(value); setDetails((old) => ({ ...old, direction: value })); setScreen("search"); setToast(`Направление: ${value} +1 ✈️`); });
    else { setDirection(value); setDetails((old) => ({ ...old, direction: value })); setScreen("search"); }
  }
  function readRow(key: string, text: string) {
    if (inFlight.current) return;
    const read = readKeys.includes(key) ? readKeys : [...readKeys, key];
    setReadKeys(read); setToast(text);
    if (read.length === 6 && index === 6) void run(() => captainAction(taskId, "checkpoint", 6, { readKeys: read }));
  }
  function openCruise() {
    if (readKeys.length !== 6) { setToast("Сначала прочитай все строки карточки 👆"); return; }
    // Retry the last reading action safely if its response was lost.
    if (index === 6) void run(() => captainAction(taskId, "checkpoint", 6, { readKeys }), () => showQuiz(7));
    else showQuiz(index === 8 ? 8 : 7);
  }
  function readCabin(value: number) {
    const read = readCabins.includes(value) ? readCabins : [...readCabins, value];
    setReadCabins(read); setToast(CRUISE_CABINS[value][3]);
  }
  function finish() {
    void run(() => captainAction(taskId, "finish"), (saved) => { if (saved.trainingDone && saved.submission) onCompleted?.(saved.submission); });
  }
  function chooseCabin(value: number) {
    if (index !== 14) return;
    const current = version.current;
    void run(async () => {
      const saved = await captainAction(taskId, "checkpoint", 14, { answer: value });
      if (current !== version.current) return saved;
      setAttempt(saved); setScreen("twist");
      return saved.index === 15 && !saved.failed ? captainAction(taskId, "finish") : saved;
    }, (saved) => { if (saved.trainingDone && saved.submission) onCompleted?.(saved.submission); });
  }
  async function openTelegram() {
    if (!detailsReady || !attempt?.trainingDone || attempt.screenshotSent || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    const current = version.current;
    try {
      const saved = await captainAction(taskId, "save-details", undefined, { details });
      if (current !== version.current) return;
      setAttempt(saved);
      if (linkRequired) {
        const linked = await createTelegramLink();
        if (current !== version.current) return;
        if (linked.url) { const target = new URL(linked.url); if (target.protocol !== "https:" || target.hostname !== "t.me") throw new Error("Некорректная ссылка Telegram."); window.location.assign(target.href); return; }
        if (!linked.linked) throw new Error("Не удалось подготовить привязку Telegram.");
        setLinkRequired(false);
      }
      const { url } = await captainTelegramLink(taskId, details);
      if (current !== version.current) return;
      const target = new URL(url);
      if (target.protocol !== "https:" || target.hostname !== "t.me") throw new Error("Некорректная ссылка Telegram.");
      setNotice("В боте нажми «Начать» / Start и отправь скриншот как фото. Сообщение о круизе добавится автоматически.");
      window.location.assign(target.href);
    } catch (cause) {
      if (current === version.current) { if (cause instanceof ApiError && cause.status === 422) setLinkRequired(true); setError(cause instanceof Error ? cause.message : "Не удалось открыть Telegram."); }
    } finally { inFlight.current = false; if (current === version.current) setBusy(false); }
  }
  async function copyMessage() {
    try { await navigator.clipboard.writeText(captainMessage(details)); setToast("Скопировано! Вставь в чат с наставником 📋"); }
    catch { setNotice("Не удалось скопировать автоматически. Выдели текст сообщения ниже и скопируй его."); }
  }

  const alert = error && <div className={styles.failure} role="alert">{error}{!attempt && <button type="button" className={styles.btn} onClick={() => setLoadKey((old) => old + 1)}>Повторить загрузку</button>}</div>;
  const coach: Partial<Record<Screen, ReactNode>> = {
    home: <><b>Задание 1.</b> Это главная страница твоего кабинета. Найди, где начинается путь к круизу, и нажми.</>,
    search: phase === 1 ? <><b>Задание 2.</b> Сначала узнай, какие круизные линии есть в клубе. Открой поле <b>«Круизная линия»</b>.</> : phase === 2 ? <><b>Задание 3.</b> Теперь выбери, куда хочешь поплыть. Нажми <b>«Круизное направление»</b>.</> : <><b>Задание 4.</b> Направление выбрано: <b>{direction}</b>. Нажми <b>«Поиск»</b>.</>,
    lines: <>Это все круизные линии клуба. <b>Посчитай их</b> и обрати внимание на значок 👑. Нажми на любую линию — узнаешь, чем она особенная.</>,
    dest: <><b>Выбери направление.</b> Подойдёт любое, но для старта рекомендуем ⭐ Средиземное море.</>,
    card: readKeys.length < 6 ? <><b>Задание 5.</b> Прочитай карточку круиза: нажми на каждую строку. Осталось: <b>{6 - readKeys.length}</b></> : <><b>Отлично!</b> Теперь открой круиз — нажми на его <b>название</b>.</>,
    cruise: readCabins.length < 4 ? <><b>Задание 6.</b> Узнай, чем отличаются каюты: нажми на каждую категорию ниже 👇 Осталось: <b>{4 - readCabins.length}</b></> : index < 11 ? <><b>Задание 7.</b> Посмотри маршрут внизу и нажми «Проверь себя».</> : <><b>Задание 8.</b> Всё изучено! Нажми <b>«Book Cruise»</b> — по-английски это «Забронировать круиз».</>,
    guests: <><b>Задание 9.</b> Добавь своих близких — выставь тех, с кем ты хотел(а) бы поплыть. Потом нажми «Продолжить».</>,
    cabin: <><b>Задание 10.</b> Это цена <b>на всю семью</b> за всю поездку — кабинет сам всё посчитал. Выбери каюту: нажми на вариант.</>,
  };
  const phoneHeader = <div className={styles.hdr}><div className={styles.logo}><span className={styles.in}>in</span>{screen !== "home" && "Cruises"}</div>{screen === "home" ? <><strong>Добро пожаловать</strong><button type="button" className={styles.menu} aria-label="Меню учебного кабинета" onClick={() => setToast("Через меню тоже можно, но быстрее — через «Быстрый доступ» 👇")}>☰</button></> : <div className={styles.icons}><span className={`${styles.ic} ${styles.on}`}>🛳</span><button type="button" className={styles.ic} aria-label="Отели" onClick={() => setToast("Отели тоже есть в клубе. Сейчас мы ищем круиз 🚢")}>🏢</button><button type="button" className={styles.ic} aria-label="Туры" onClick={() => setToast("Туры тоже есть в клубе. Сейчас мы ищем круиз 🚢")}>🌐</button><span className={styles.av}>👤</span></div>}</div>;
  const body: Partial<Record<Screen, ReactNode>> = {
    intro: <div className={`${styles.card} ${styles.center}`}><div className={styles.big}>🚢</div><h3>Тренировка: {CAPTAIN_CRUISE_TITLE}</h3><p className={styles.muted}>Ты пройдёшь путь по кабинету inCruises — как настоящий. Здесь можно нажимать куда угодно: ничего не сломается.</p><p>В конце ты будешь знать:<br />✓ какие круизные линии есть в клубе<br />✓ какие бывают каюты<br />✓ сколько стоит круиз на одного, на двоих и на семью</p><p className={styles.muted}>За правильные действия — ✈️ мили</p><button type="button" className={styles.btn} disabled={!attempt || busy} onClick={() => setScreen("home")}>{attempt ? "Начать тренировку" : "Загружаем прогресс…"}</button><p className={styles.note}>19 миль за тренировку + 1 за настоящий скриншот. Это учебный кабинет: здесь нет платежей и бронирований.</p></div>,
    home: <>{phoneHeader}<div className={`${styles.card} ${styles.center}`}><div className={`${styles.av} ${styles.profile}`}>👤</div><h3 className={styles.name}>Твоё имя</h3><div className={styles.muted}>твой-сайт.incruises.com</div><div className={styles.pill}>✓ Доступно</div><div><button type="button" className={styles.more} onClick={() => setToast("Здесь информация о твоём сайте. Сейчас мы ищем круиз 🚢")}>Узнать подробнее</button></div></div><h2>Быстрый доступ</h2><div className={styles.grid3}>{[["🛳", "круиз"], ["🏢", "отель"], ["🧭", "тур"]].map(([icon, name], i) => <button type="button" className={styles.tile} key={name} disabled={busy} onClick={() => i === 0 ? void run(() => captainAction(taskId, "checkpoint", 0, { answer: 0 }), () => { setScreen("search"); showQuiz(1); }) : setToast(i === 1 ? "Почти! Отели тоже можно бронировать в клубе, но сейчас мы ищем круиз 🚢" : "Туры тоже есть в клубе! Но сейчас мы ищем круиз 🚢")}><span className={styles.circ}>{icon}</span>Забронировать {name}</button>)}</div></>,
    search: <>{phoneHeader}<div className={styles.banner}>21 000 уникальных вариантов круизных путешествий со всего мира ждут вас!</div><div className={`${styles.card} ${styles.searchForm}`}><div className={styles.lbl}>Круизное направление</div><button type="button" className={`${styles.field} ${direction ? styles.done : ""}`} aria-label="Круизное направление" disabled={busy} onClick={() => phase === 1 ? setToast("Сначала загляни в «Круизная линия» 👇") : setScreen("dest")}><span>{direction || "All Destinations"}</span><span>🔍</span></button><div className={styles.lbl}>Круизная линия</div><button type="button" className={styles.field} aria-label="Круизная линия" onClick={() => setScreen("lines")}><span>Все круизные линии</span><span>⌄</span></button><div className={styles.lbl}>Дата отправления</div><button type="button" className={`${styles.field} ${styles.muted}`} onClick={() => setToast("Дату можно не выбирать — тогда покажутся все даты.")}><span>Выберите дату отправления</span><span>📅</span></button><div className={styles.btns}><button type="button" className={styles.bo} onClick={() => phase < 3 ? setToast("Сначала выполни задание сверху ☝️") : setScreen("card")}>Поиск</button><button type="button" className={styles.bw} onClick={() => setToast("♡ «Избранные» — круизы, которые ты сохранил, чтобы вернуться к ним позже.")}>♡ Избранные</button></div></div></>,
    lines: <>{phoneHeader}<div className={styles.card}><div className={styles.listHeader}>Все круизные линии</div>{CRUISE_LINES.map(([name, premium, text]) => <button type="button" className={styles.row} key={name} onClick={() => setToast(text)}><span>{name}{premium && <span className={styles.crown} aria-label="Премиум и люкс">👑</span>}</span><span className={styles.muted}>ⓘ</span></button>)}</div><button type="button" className={styles.btn} onClick={() => index >= 5 ? setScreen("search") : showQuiz(index)}>{index >= 5 ? "Назад к поиску" : "Я посчитал(а) →"}</button></>,
    dest: <><label className={styles.destinationSearch}><span className={styles.srOnly}>Поиск направления</span><input type="search" placeholder="Введите круизное направление" value={filter} onChange={(event) => setFilter(event.target.value)} /></label><div className={styles.card}>{CRUISE_DIRECTIONS.filter((value) => value.toLowerCase().includes(filter.toLowerCase().trim())).map((value) => <button type="button" className={styles.row} disabled={busy} key={value} onClick={() => pickDirection(value)}><span>{value}</span>{value === "Средиземное море" && <span className={styles.badge}>⭐ Рекомендуем</span>}</button>)}{!CRUISE_DIRECTIONS.some((value) => value.toLowerCase().includes(filter.toLowerCase().trim())) && <p className={styles.muted}>Направление не найдено</p>}</div><button type="button" className={styles.bw} onClick={() => setScreen("search")}>Назад к поиску</button></>,
    card: <>{phoneHeader}{direction !== "Средиземное море" && <div className={styles.coach}>В тренировке покажем пример по Средиземному морю. Своё направление найдёшь в настоящем кабинете 😉</div>}<div className={styles.card}><div className={styles.ship}>🛳<span className={styles.st}>★★★★★</span></div><button type="button" className={`${styles.info} ${readKeys.includes("line") ? styles.read : ""}`} disabled={busy} onClick={() => readRow("line", CRUISE_CARD_ROWS[0][3])}><span className={styles.msc}>MSC <small>CRUISES</small></span></button><button type="button" className={styles.ttl} disabled={busy} onClick={openCruise}>{CRUISE_TITLE}</button>{CRUISE_CARD_ROWS.slice(1, 5).map(([key, icon, label, text]) => <button type="button" className={`${styles.info} ${readKeys.includes(key) ? styles.read : ""}`} key={key} disabled={busy} onClick={() => readRow(key, text)}><span>{icon}</span><span>{label}</span>{readKeys.includes(key) && <span className={styles.check}>✓</span>}</button>)}<button type="button" className={`${styles.price} ${readKeys.includes("price") ? styles.read : ""}`} disabled={busy} onClick={() => readRow("price", CRUISE_CARD_ROWS[5][3])}>От <b>$1,316</b> <span>/за человека</span> ⓘ</button></div></>,
    cruise: <>{phoneHeader}<p className={`${styles.muted} ${styles.note}`}>Результаты / 7 nights Western Mediterranean…</p><div className={styles.card}><h3>{CRUISE_TITLE}</h3><div className={styles.muted}>От <b className={styles.mscSmall}>MSC CRUISES</b></div>{["🌙 Ночей: 7", "🛳 MSC World Europa", "📍 Civitavecchia", "📅 2027-09-01 до 2027-09-08"].map((text) => <div className={styles.info} key={text}>{text}</div>)}<div className={styles.stars}>★★★★★</div><button type="button" className={styles.btn} onClick={() => index >= 11 ? setScreen("guests") : setToast("Сначала изучи каюты и маршрут ниже 👇")}>Book Cruise</button></div><div className={styles.card}><h3>Номера, начиная от</h3>{CRUISE_CABINS.map(([icon, name, price], i) => <button type="button" className={`${styles.cat} ${readCabins.includes(i) ? styles.catRead : ""}`} key={name} onClick={() => readCabin(i)}><span><span className={styles.muted}>{icon} {name}</span><strong>{price}</strong></span><span className={readCabins.includes(i) ? styles.ok : styles.muted}>{readCabins.includes(i) ? "✓" : "ⓘ"}</span></button>)}</div><div className={styles.card}><h3>Маршрут</h3>{CRUISE_PORTS.map((port, i) => <div className={styles.port} key={port}><span className={styles.dot}>{i === 5 ? "↩" : i + 1}</span><span>{["🇮🇹", "🇪🇸", "🇪🇸", "🇫🇷", "🇮🇹", "🇮🇹"][i]} {port}</span></div>)}<p className={styles.muted}>Корабль переезжает ночью, а утром ты просыпаешься в новом городе. Вещи распаковываешь один раз.</p>{index >= 11 ? <div className={styles.ok}>✓ Маршрут изучен</div> : <button type="button" className={`${styles.btn} ${styles.dark}`} onClick={() => index === 9 && readCabins.length < 4 ? setToast("Сначала изучи все четыре каюты 👆") : showQuiz(index)}>Проверь себя</button>}</div></>,
    guests: <>{phoneHeader}<div className={styles.card}><h3>Выберите, как вы хотите продолжить своё бронирование</h3><p className={styles.muted}>Укажите всех пассажиров — и членов клуба inCruises, и тех, кто не в клубе. Возраст будет рассчитан на дату посадки 2027-09-01.</p>{GUEST_LABELS.map(([label, age], i) => <div className={styles.cnt} key={label}><div><strong>{label}</strong><div className={styles.muted}>{age}</div></div><div className={styles.ctl}><button type="button" aria-label={`Уменьшить: ${label}`} disabled={busy || guests[i] === 0} onClick={() => setGuests((old) => old.map((n, j) => i === j ? n - 1 : n))}>−</button><output aria-label={label}>{guests[i]}</output><button type="button" aria-label={`Добавить: ${label}`} disabled={busy || guests[i] === 8} onClick={() => setGuests((old) => old.map((n, j) => i === j ? n + 1 : n))}>+</button></div></div>)}<div className={styles.coach}>💡 С тобой могут ехать все — даже те, кто не в клубе.<br />🎂 Возраст считается на дату посадки, а не на сегодня.</div><button type="button" className={styles.btn} onClick={() => guests.some(Boolean) ? showQuiz(index) : setToast("Добавь хотя бы одного пассажира 🙂")}>Продолжить →</button></div></>,
    cabin: <>{phoneHeader}<div className={styles.card}><div className={styles.muted}>Шаг 2 из 8</div><h3>Выберите категорию каюты</h3><div className={styles.pbar}><i style={{ width: "25%" }} /></div><div className={styles.tabs}>{CRUISE_CABINS.map(([, label], i) => <button type="button" className={`${styles.tab} ${i === 1 ? styles.tabOn : ""}`} key={label} onClick={() => i !== 1 && setToast("В тренажёре пример только для «С видом на море». В своём кабинете сравни все категории 😉")}>{label}</button>)}</div><div className={`${styles.muted} ${styles.note}`}>Пример: 2 взрослых + 2 детей</div>{[["Deluxe Ocean View", "$5,564.48"], ["Infinite Ocean View", "$5,846.08"]].map(([label, price], i) => <button type="button" className={styles.opt2} disabled={busy || index !== 14} key={label} onClick={() => chooseCabin(i)}><span><span>{label}</span><span className={styles.muted}>Начало в </span><b>{price}</b></span><span className={styles.chevron}>›</span></button>)}<p className={`${styles.muted} ${styles.note}`}>Infinite Ocean View у MSC — каюта с большим окном, которое частично опускается: почти балкон.</p></div></>,
    twist: <>{attempt?.screenshotSent ? <div className={`${styles.card} ${styles.center}`} role="status"><div className={styles.big}>🏅</div><h3>Достижение «Капитан-разведчик»</h3><p>Задание выполнено! Ты заработал(а) <b>20 ✈️ миль</b></p><p className={styles.muted}>Скриншот сохранён для доставки наставникам. Все 20 миль уже в рейтинге.</p></div> : <><div className={`${styles.card} ${styles.center}`}><div className={styles.big}>🎉</div><h3>Это была тренировка!</h3><p>{attempt?.trainingDone ? <>Ты прошёл(ла) весь путь капитана и заработал(а) <b>19 ✈️ миль</b></> : "Тренировка пройдена. Осталось сохранить завершение и начислить мили."}</p><p className={styles.recap}>✓ В клубе <b>14 круизных линий</b><br />✓ Каюты бывают 4 видов: внутренняя, с видом на море, балкон, сюита<br />✓ Цену на семью кабинет считает сам<br />✓ Даты: сначала месяц, потом день</p>{!attempt?.trainingDone && <button type="button" className={styles.btn} disabled={busy} onClick={finish}>{busy ? "Начисляем мили…" : "Получить 19 миль"}</button>}</div><div className={styles.card}><h3>⚓ Теперь — настоящее плавание</h3><ol className={styles.steps}><li>Открой <a href="https://www.incruises.com" target="_blank" rel="noopener noreferrer">incruises.com ↗</a> и войди в свой кабинет</li><li>Нажми <b>«Забронировать круиз»</b></li><li>Выбери направление (можно ⭐ Средиземное море)</li><li>Найди круиз и нажми <b>«Book Cruise»</b></li><li>Добавь своих близких и выбери каюту</li><li>Сделай <b>скриншот</b> с ценой — бронировать и платить не нужно</li><li>Отправь его наставнику с сообщением ниже</li></ol><form onSubmit={(event) => { event.preventDefault(); void openTelegram(); }}>{([["direction", "Направление", "Например, Средиземное море"], ["line", "Круизная линия", "например, MSC Cruises"], ["who", "Кто едет", "2 взрослых и 2 детей"], ["price", "Цена за всех", "$"]] as const).map(([key, label, placeholder]) => <label className={styles.lbl} key={key}>{label}<input value={details[key]} maxLength={120} required disabled={busy} placeholder={placeholder} onChange={(event) => { setDetails((old) => ({ ...old, [key]: event.target.value })); setNotice(""); }} /></label>)}<div className={styles.msg}>{captainMessage({ direction: details.direction || "___", line: details.line || "___", who: details.who || "___", price: details.price || "___" })}</div><button type="button" className={`${styles.btn} ${styles.dark}`} disabled={!detailsReady} onClick={() => void copyMessage()}>📋 Копировать</button>{alert}{notice && <p className={styles.expl} role="status">{notice}</p>}<button type="submit" className={`${styles.btn} ${styles.green}`} disabled={busy || !detailsReady || !attempt?.trainingDone}>{busy ? "Подготавливаем…" : linkRequired ? "Привязать Telegram" : "📤 Отправить наставнику · +1 миля"}</button><button type="button" className={styles.save} disabled={busy || !detailsReady || !attempt?.trainingDone} onClick={() => void run(() => captainAction(taskId, "save-details", undefined, { details }), () => setNotice("Данные сохранены. Можешь вернуться к отправке позже."))}>Сохранить и отправить позже</button><p className={styles.note}>В Telegram нажми Start и отправь одно фото. Текст добавится автоматически. +1 миля начислится за скриншот, а не за переход.</p></form></div></>}</>,
  };
  const progress = Math.round(ROUTE.indexOf(screen === "lines" || screen === "dest" ? "search" : screen) / (ROUTE.length - 1) * 100);
  return <section className={styles.game} aria-label={`Тренировка ${CAPTAIN_CRUISE_TITLE}`} data-captain-screen={screen}>
    <div className={styles.wrap} inert={quizIndex !== null}><header className={styles.top}><div className={styles.mrow}><span>🚢 {CAPTAIN_CRUISE_TITLE}</span><span className={styles.m}>✈️ {attempt?.trainingDone ? attempt.earnedPoints : attempt?.trainingPoints || 0} миль</span></div><div className={styles.pbar} role="progressbar" aria-label="Прогресс тренировки" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div></header>{coach[screen] && <div className={styles.coach}>{coach[screen]}</div>}<div ref={content} tabIndex={-1}>{screen === "intro" || screen === "twist" ? body[screen] : <div className={styles.phone}>{body[screen]}</div>}{screen !== "twist" && quizIndex === null && alert}</div><p className={styles.note}>Учебные цены и списки взяты из тренажёра. Актуальные условия проверяй в своём кабинете inCruises.</p></div>
    {stage && <div className={styles.modal}><div ref={sheet} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={`${id}-question`} tabIndex={-1} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
      if (event.key !== "Tab") return;
      event.stopPropagation();
      const controls = Array.from(sheet.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}><div className={styles.qh}>🧭 Вопрос капитана · +{stage.miles} ✈️</div><h3 className={styles.qq} id={`${id}-question`}>{stage.title}</h3>{stage.options.map((option, i) => <button type="button" className={`${styles.opt} ${selected === i ? feedback === "incorrect" ? styles.bad : feedback === "correct" ? styles.correct : "" : ""}`} key={option} disabled={busy || Boolean(feedback)} aria-pressed={selected === i} onClick={() => answer(i)}>{option}</button>)}{feedback === "correct" && <><div className={styles.expl} role="status">✅ {stage.explanation}</div><button type="button" className={styles.btn} onClick={nextQuiz}>Дальше →</button></>}{feedback === "incorrect" && <div className={styles.hintw} role="alert">Не совсем 🙂 Попробуй ещё раз<button type="button" className={`${styles.btn} ${styles.dark}`} disabled={busy} onClick={() => void run(() => captainAction(taskId, "retry", quizIndex!), () => { setFeedback(""); setSelected(null); })}>Попробовать ещё раз</button></div>}{alert}</div></div>}
    {toast && <div className={styles.toast} role="status">{toast}</div>}
  </section>;
}
