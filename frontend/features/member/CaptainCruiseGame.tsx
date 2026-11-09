"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CAPTAIN_CRUISE_REWARD, CAPTAIN_CRUISE_TITLE, CAPTAIN_STAGES, CAPTAIN_TRAINING_REWARD, CRUISE_CABINS, CRUISE_CARD_ROWS, CRUISE_DIRECTIONS, CRUISE_LINE_COUNT, CRUISE_LINES, CRUISE_PORTS, captainMessage, type CaptainCruiseDetails } from "@/shared/domain/captain-cruise";
import { captainAction, captainTelegramLink, type CaptainAttempt } from "@/frontend/shared/api/captain-cruise-client";
import { ApiError, createTelegramLink } from "@/frontend/shared/api/client";
import type { Submission } from "@/shared/domain/types";
import { CaptainCruiseMaterial, MaterialButton } from "./GameMaterial";
import styles from "./CaptainCruiseGame.module.css";

type Screen = "intro" | "home" | "search" | "lines" | "dest" | "card" | "cruise" | "guests" | "cabin" | "twist";
// The pinned task at the bottom: number, text, progress dots and the text once the step is done.
type Task = { n?: number; text: ReactNode; progress?: [number, number]; done?: boolean; doneText?: ReactNode };
const ROUTE: Screen[] = ["intro", "home", "search", "card", "cruise", "guests", "cabin", "twist"];
const CRUISE_TITLE = "7 Nights Western Mediterranean From Civitavecchia (Rome)";
const GUEST_LABELS = [["Взрослые", "18–54 лет"], ["Дети и подростки", "0–17 лет"], ["Пожилые", "55+ лет"]] as const;
// Where a saved attempt resumes: the screen of its next checkpoint and the question to reopen.
function initialView(index: number): { screen: Screen; quiz: number | null } {
  if (index === 0) return { screen: "intro", quiz: null };
  if (index <= 2) return { screen: "search", quiz: index === 1 ? 1 : null };
  if (index <= 5) return { screen: "lines", quiz: index };
  if (index === 6) return { screen: "search", quiz: null };
  if (index <= 9) return { screen: "card", quiz: index === 7 ? null : index };
  if (index <= 11) return { screen: "cruise", quiz: null };
  if (index <= 13) return { screen: "guests", quiz: index === 13 ? index : null };
  if (index <= 15) return { screen: "cabin", quiz: index === 14 ? index : null };
  return { screen: "twist", quiz: null };
}
const miles = (n: number) => `${n} ✈️ ${n % 10 === 1 && n % 100 !== 11 ? "миля" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "мили" : "миль"}`;
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
  const [open, setOpen] = useState("");
  const [seenLines, setSeenLines] = useState<number[]>([]);
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
  const [material, setMaterial] = useState(false);
  const inFlight = useRef(false), version = useRef(0);
  const content = useRef<HTMLDivElement>(null), sheet = useRef<HTMLDivElement>(null);
  const id = useId();
  const index = attempt?.index ?? 0;
  const phase = index <= 5 ? 1 : index === 6 ? 2 : 3;
  const stage = quizIndex === null ? null : CAPTAIN_STAGES[quizIndex];
  const detailsReady = Object.values(details).every((value) => value.trim().length > 0 && value.length <= 120);
  const earned = attempt?.trainingDone ? attempt.earnedPoints : attempt?.trainingPoints || 0;

  useEffect(() => {
    const current = ++version.current;
    void captainAction(taskId, "start").then((saved) => {
      if (current !== version.current) return;
      const view = initialView(saved.index);
      setAttempt(saved); setScreen(view.screen); setQuizIndex(saved.failed ? saved.index : view.quiz);
      setSelected(saved.failed ? saved.lastAnswer ?? null : null); setFeedback(saved.failed ? "incorrect" : "");
      // These reading prerequisites have already been checked by the server.
      setSeenLines(saved.index >= 6 ? CRUISE_LINES.map((_, i) => i) : []);
      setReadKeys(saved.index >= 8 ? CRUISE_CARD_ROWS.map(([key]) => key) : []);
      setReadCabins(saved.index >= 11 || (saved.index === 10 && saved.failed) ? [0, 1, 2, 3] : []);
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
  useEffect(() => { if (open) content.current?.querySelector("[data-desc]")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [open]);
  useEffect(() => { if (quizIndex !== null) sheet.current?.focus({ preventScroll: true }); }, [quizIndex]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (screen !== "cruise" || index !== 10 || readCabins.length !== 4 || quizIndex !== null) return;
    // Same short pause as the HTML: show the last cabin's hint before the question.
    const timer = setTimeout(() => { setQuizIndex(10); setSelected(null); setFeedback(""); setError(""); }, 700);
    return () => clearTimeout(timer);
  }, [screen, index, readCabins.length, quizIndex]);

  async function run(action: () => Promise<CaptainAttempt>, success?: (saved: CaptainAttempt) => void) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    const current = version.current, before = attempt?.trainingPoints ?? 0;
    try {
      const saved = await action();
      if (current !== version.current) return;
      setAttempt(saved);
      if (!saved.trainingDone && saved.trainingPoints > before) setToast(`+${miles(saved.trainingPoints - before)}`);
      success?.(saved);
    }
    catch (cause) { if (current === version.current) setError(cause instanceof Error ? cause.message : "Не удалось сохранить прогресс. Повтори попытку."); }
    finally { inFlight.current = false; if (current === version.current) setBusy(false); }
  }
  function go(next: Screen) { setOpen(""); setScreen(next); }
  function showQuiz(step: number) { setQuizIndex(step); setSelected(null); setFeedback(""); setError(""); }
  // «Покажи, куда нажать»: scroll to the first unread item, else to the next control, and blink it.
  function showLeft() {
    const target = content.current?.querySelector<HTMLElement>("[data-todo]") || content.current?.querySelector<HTMLElement>("[data-next]");
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.remove(styles.flash); void target.offsetWidth; target.classList.add(styles.flash);
    setTimeout(() => target.classList.remove(styles.flash), 1900);
  }
  function hint(text: string) { setToast(text); showLeft(); }
  function answer(value: number) {
    if (quizIndex === null || feedback || inFlight.current) return;
    setSelected(value);
    void run(() => captainAction(taskId, "checkpoint", quizIndex, { answer: value, ...(quizIndex === 10 ? { readCabins } : {}), ...(quizIndex === 12 ? { guests } : {}) }), (saved) => setFeedback(saved.failed ? "incorrect" : "correct"));
  }
  function nextQuiz() {
    if (feedback !== "correct" || busy || quizIndex === null) return;
    const previous = quizIndex;
    setQuizIndex(null); setFeedback(""); setSelected(null); setError("");
    if ([2, 3, 4, 8, 12].includes(previous)) showQuiz(previous + 1);
    else if (previous === 5) go("search");
    else if (previous === 9) go("cruise");
    else if (previous === 13) { setDetails((old) => ({ ...old, who: family(guests) })); go("cabin"); showQuiz(14); }
    else content.current?.focus({ preventScroll: true });
  }
  function toggle(key: string) {
    const kind = key[0], i = Number(key.slice(1));
    setOpen((old) => old === key ? "" : key);
    if (kind === "L" && !seenLines.includes(i)) setSeenLines([...seenLines, i]);
    if (kind === "K" && !readCabins.includes(i)) setReadCabins([...readCabins, i]);
    if (kind === "C") {
      const row = CRUISE_CARD_ROWS[i][0];
      if (inFlight.current || readKeys.includes(row)) return;
      const read = [...readKeys, row];
      setReadKeys(read);
      if (read.length === CRUISE_CARD_ROWS.length && index === 7) void run(() => captainAction(taskId, "checkpoint", 7, { readKeys: read }));
    }
  }
  function pickDirection(value: string) {
    if (index === 6) void run(() => captainAction(taskId, "checkpoint", 6, { direction: value }), () => { setDirection(value); setDetails((old) => ({ ...old, direction: value })); go("search"); });
    else { setDirection(value); setDetails((old) => ({ ...old, direction: value })); go("search"); }
  }
  function openCruise() {
    if (readKeys.length !== CRUISE_CARD_ROWS.length) { hint("Сначала прочитай все строки 👇"); return; }
    // Retry the last reading action safely if its response was lost.
    if (index === 7) void run(() => captainAction(taskId, "checkpoint", 7, { readKeys }), () => showQuiz(8));
    else showQuiz(index === 9 ? 9 : 8);
  }
  function routeQuiz() {
    if (index === 10 && readCabins.length < 4) hint("Сначала изучи все четыре каюты 👆");
    else if (index === 10 || index === 11) showQuiz(index);
  }
  function guestsNext() {
    if (!guests.some(Boolean)) { setToast("Добавь хотя бы одного пассажира 🙂"); return; }
    if (index >= 14) go("cabin"); else showQuiz(index);
  }
  function finish() {
    void run(() => captainAction(taskId, "finish"), (saved) => { if (saved.trainingDone && saved.submission) onCompleted?.(saved.submission); });
  }
  function chooseCabin(value: number) {
    if (index === 14) { showQuiz(14); return; }
    if (index !== 15) return;
    const current = version.current;
    void run(async () => {
      const saved = await captainAction(taskId, "checkpoint", 15, { answer: value });
      if (current !== version.current) return saved;
      setAttempt(saved); go("twist");
      return saved.index === 16 && !saved.failed ? captainAction(taskId, "finish") : saved;
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
    try { await navigator.clipboard.writeText(captainMessage(details)); setToast("Скопировано 📋"); }
    catch { setNotice("Не удалось скопировать автоматически. Выдели текст сообщения ниже и скопируй его."); }
  }

  const alert = error && <div className={styles.failure} role="alert">{error}{!attempt && <button type="button" className={styles.btn} onClick={() => setLoadKey((old) => old + 1)}>Повторить загрузку</button>}</div>;
  const desc = (key: string, text: string) => open === key && <div className={styles.desc} data-desc>💬 {text}</div>;
  const cabinsRead = readCabins.length, cruiseDone = cabinsRead + (index >= 12 ? 1 : 0);
  const tasks: Record<Screen, Task> = {
    intro: { text: <>Нажми «Начать тренировку»</> },
    home: { n: 1, text: <>Это главная страница твоего кабинета. Найди, где начинается путь к круизу, и нажми.</> },
    search: phase === 1 ? { n: 2, text: <>Узнай, какие круизные линии есть в клубе. Нажми на поле <b>«Круизная линия»</b>.</> } : phase === 2 ? { n: 3, text: <>Выбери, куда хочешь поплыть. Нажми на поле <b>«Круизное направление»</b>.</> } : { n: 4, text: <>Направление выбрано: <b>{direction}</b>. Теперь нажми <b>«Поиск»</b>.</> },
    lines: { n: 2, text: <>Это все круизные линии клуба. Нажимай на линии — под каждой откроется описание. <b>Посчитай их</b> и обрати внимание на значки 👑 и 🌊.</>, progress: [seenLines.length, CRUISE_LINE_COUNT], done: seenLines.length >= CRUISE_LINE_COUNT, doneText: index >= 6 ? <>Все линии изучены! Нажми <b>«Назад к поиску»</b>.</> : <>Все линии изучены! Нажми <b>«Я посчитал(а)»</b>.</> },
    dest: { n: 3, text: <>Выбери направление. Подойдёт любое, для старта рекомендуем ⭐ <b>Средиземное море</b>.</> },
    card: { n: 5, text: <>Прочитай карточку круиза: нажми на каждую строку — под ней откроется подсказка.</>, progress: [readKeys.length, CRUISE_CARD_ROWS.length], done: readKeys.length >= CRUISE_CARD_ROWS.length, doneText: <>Карточка прочитана! Теперь нажми на <b>название круиза</b>, чтобы открыть его.</> },
    cruise: { n: 6, text: cabinsRead < 4 ? <>Узнай, чем отличаются каюты: нажми на каждую категорию. Потом посмотри маршрут и нажми «Проверь себя».</> : <>Каюты изучены 👍 Теперь посмотри маршрут ниже и нажми <b>«Проверь себя»</b>.</>, progress: [cruiseDone, 5], done: cruiseDone >= 5, doneText: <>Всё изучено! Нажми <b>«Book Cruise»</b> — по-английски это «Забронировать круиз».</> },
    guests: { n: 7, text: <>Добавь своих близких — выставь тех, с кем хотел(а) бы поплыть. Потом нажми <b>«Продолжить»</b>.</> },
    cabin: { n: 8, text: <>Это цена <b>на всю семью</b> за всю поездку — кабинет сам всё посчитал. Выбери каюту: нажми на вариант.</> },
    twist: attempt?.screenshotSent ? { text: <>🏅 Задание выполнено! Можно переходить к следующему блоку.</>, done: true } : { n: 9, text: <>Найди свой круиз в настоящем кабинете, заполни поля и нажми <b>«Отправить наставнику»</b>. Не забудь скриншот 📸</> },
  };
  const task = tasks[screen];
  const [seen, total] = task.progress || [0, 0];
  const dots = task.progress ? total <= 8 ? <>{"●".repeat(Math.min(seen, total))}{"○".repeat(Math.max(total - seen, 0))} <b>{Math.min(seen, total)} из {total}</b></> : <>Открыто: <b>{Math.min(seen, total)} из {total}</b></> : null;
  const phoneHeader = <div className={styles.hdr}><div className={styles.logo}><span className={styles.in}>in</span>{screen !== "home" && "Cruises"}</div>{screen === "home" ? <><strong>Добро пожаловать</strong><button type="button" className={styles.menu} aria-label="Меню учебного кабинета" onClick={() => setToast("Через меню тоже можно, но быстрее — через «Быстрый доступ» 👇")}>☰</button></> : <div className={styles.icons}><span className={`${styles.ic} ${styles.on}`}>🛳</span><span className={styles.ic}>🏢</span><span className={styles.ic}>🌐</span><span className={styles.av}>👤</span></div>}</div>;
  const body: Record<Screen, ReactNode> = {
    intro: <div className={`${styles.card} ${styles.center}`}><div className={styles.big}>🚢</div><h3>Тренировка: {CAPTAIN_CRUISE_TITLE}</h3><p className={styles.muted}>Ты пройдёшь путь по кабинету inCruises — как настоящий. Здесь можно нажимать куда угодно: ничего не сломается.</p><p className={styles.recap}>В конце ты будешь знать:<br />✓ какие круизные линии есть в клубе<br />✓ какие бывают каюты<br />✓ сколько стоит круиз на одного, на двоих и на семью</p><p className={styles.muted}>Задание внизу экрана всегда подскажет, что делать дальше 👇<br />За задание — <b>{miles(CAPTAIN_CRUISE_REWARD)}</b></p><button type="button" className={styles.btn} data-next disabled={!attempt || busy} onClick={() => go("home")}>{attempt ? "Начать тренировку" : "Загружаем прогресс…"}</button></div>,
    home: <>{phoneHeader}<div className={`${styles.card} ${styles.center}`}><div className={`${styles.av} ${styles.profile}`}>👤</div><h3 className={styles.name}>Твоё имя</h3><div className={styles.muted}>твой-сайт.incruises.com</div><div className={styles.pill}>✓ Доступно</div><div><button type="button" className={styles.more} onClick={() => setToast("Здесь информация о твоём сайте")}>Узнать подробнее</button></div></div><h2>Быстрый доступ</h2><div className={styles.grid3}>{[["🛳", "круиз"], ["🏢", "отель"], ["🧭", "тур"]].map(([icon, name], i) => <button type="button" className={styles.tile} key={name} data-next={i === 0 || undefined} disabled={busy} onClick={() => i === 0 ? void run(() => captainAction(taskId, "checkpoint", 0, { answer: 0 }), () => { go("search"); showQuiz(1); }) : setToast(`${i === 1 ? "Отели" : "Туры"} тоже есть в клубе, но сейчас ищем круиз 🚢`)}><span className={styles.circ}>{icon}</span>Забронировать {name}</button>)}</div></>,
    search: <>{phoneHeader}<div className={styles.banner}>21 000 уникальных вариантов круизных путешествий со всего мира ждут вас!</div><div className={`${styles.card} ${styles.searchForm}`}><div className={styles.lbl}>Круизное направление</div><button type="button" className={`${styles.field} ${direction ? styles.done : ""}`} aria-label="Круизное направление" data-next={phase === 2 || undefined} disabled={busy} onClick={() => phase === 1 ? setToast("Сначала загляни в «Круизная линия» 👇") : go("dest")}><span>{direction || "All Destinations"}</span><span>🔍</span></button><div className={styles.lbl}>Круизная линия</div><button type="button" className={styles.field} aria-label="Круизная линия" data-next={phase === 1 || undefined} onClick={() => go("lines")}><span>Все круизные линии</span><span>⌄</span></button><div className={styles.lbl}>Дата отправления</div><button type="button" className={`${styles.field} ${styles.muted}`} onClick={() => setToast("Дату можно не выбирать — покажутся все даты")}><span>Выберите дату отправления</span><span>📅</span></button><div className={styles.btns}><button type="button" className={styles.bo} data-next={phase === 3 || undefined} onClick={() => phase < 3 ? setToast("Сначала выполни задание внизу 👇") : go("card")}>Поиск</button><button type="button" className={styles.bw} onClick={() => setToast("♡ Здесь круизы, которые ты сохранил")}>♡ Избранные</button></div></div></>,
    lines: <>{phoneHeader}<div className={styles.card}><div className={styles.listHeader}>Все круизные линии</div>{CRUISE_LINES.map(([name, mark, text], i) => <div key={name}><button type="button" className={`${styles.row} ${open === `L${i}` ? styles.sel : ""} ${seenLines.includes(i) ? styles.seen : ""}`} aria-expanded={open === `L${i}`} data-todo={!seenLines.includes(i) || undefined} onClick={() => toggle(`L${i}`)}><span>{name}{mark === "crown" ? <span className={styles.crown} aria-label="Премиум и люкс">👑</span> : mark === "river" && <span className={styles.river} aria-label="Речные круизы">🌊</span>}</span><span className={styles.st}>{seenLines.includes(i) ? "✓" : open === `L${i}` ? "⌃" : "ⓘ"}</span></button>{desc(`L${i}`, text)}</div>)}</div><button type="button" className={styles.btn} data-next onClick={() => index >= 6 ? go("search") : showQuiz(index)}>{index >= 6 ? "Назад к поиску" : "Я посчитал(а) →"}</button></>,
    dest: <><label className={styles.destinationSearch}><span className={styles.srOnly}>Поиск направления</span><input type="search" placeholder="Введите круизное направление" value={filter} onChange={(event) => setFilter(event.target.value)} /></label><div className={styles.card}>{CRUISE_DIRECTIONS.filter((value) => value.toLowerCase().includes(filter.toLowerCase().trim())).map((value) => <button type="button" className={styles.row} disabled={busy} key={value} data-next={value === "Средиземное море" || undefined} onClick={() => pickDirection(value)}><span>{value}</span>{value === "Средиземное море" && <span className={styles.badge}>⭐ Рекомендуем</span>}</button>)}{!CRUISE_DIRECTIONS.some((value) => value.toLowerCase().includes(filter.toLowerCase().trim())) && <p className={styles.muted}>Направление не найдено</p>}</div><button type="button" className={styles.bw} onClick={() => go("search")}>Назад к поиску</button></>,
    card: <>{phoneHeader}{direction && direction !== "Средиземное море" && <div className={styles.tip}>В тренировке покажем пример по Средиземному морю. Своё направление найдёшь в настоящем кабинете 😉</div>}<div className={styles.card}><div className={styles.ship}>🛳<span className={styles.st}>★★★★★</span></div>{CRUISE_CARD_ROWS.map(([key, icon, label, text], i) => {
      const read = readKeys.includes(key);
      const row = <><button type="button" className={`${i === 5 ? styles.price : styles.info} ${open === `C${i}` ? styles.sel : ""} ${read ? styles.read : ""}`} aria-expanded={open === `C${i}`} data-todo={!read || undefined} disabled={busy} onClick={() => toggle(`C${i}`)}>{i === 0 ? <span className={styles.msc}>MSC <small>CRUISES</small></span> : i === 5 ? <>От <b>$1,316</b> <span>/за человека</span></> : <><span>{icon}</span><span>{label}</span></>}{read && <span className={styles.check}>✓</span>}</button>{desc(`C${i}`, text)}</>;
      return <div key={key}>{row}{i === 0 && <button type="button" className={styles.ttl} data-next={readKeys.length === CRUISE_CARD_ROWS.length || undefined} disabled={busy} onClick={openCruise}>{CRUISE_TITLE}</button>}</div>;
    })}</div></>,
    cruise: <>{phoneHeader}<p className={`${styles.muted} ${styles.note}`}>Результаты / 7 nights Western Mediterranean…</p><div className={styles.card}><h3>{CRUISE_TITLE}</h3><div className={styles.muted}>От <b className={styles.mscSmall}>MSC CRUISES</b></div>{["🌙 Ночей: 7", "🛳 MSC World Europa", "📍 Civitavecchia", "📅 2027-09-01 до 2027-09-08"].map((text) => <div className={styles.info} key={text}>{text}</div>)}<div className={styles.stars}>★★★★★</div><button type="button" className={styles.btn} data-next={index >= 12 || undefined} onClick={() => index >= 12 ? go("guests") : hint("Сначала изучи каюты и маршрут 👇")}>Book Cruise</button></div><div className={styles.card}><h3>Номера, начиная от</h3>{CRUISE_CABINS.map(([icon, name, price, text], i) => <div key={name}><button type="button" className={`${styles.cat} ${readCabins.includes(i) ? styles.catRead : ""} ${open === `K${i}` ? styles.sel : ""}`} aria-expanded={open === `K${i}`} data-todo={!readCabins.includes(i) || undefined} onClick={() => toggle(`K${i}`)}><span><span className={styles.muted}>{icon} {name}</span><strong>{price}</strong></span><span className={readCabins.includes(i) ? styles.ok : styles.muted}>{readCabins.includes(i) ? "✓" : "ⓘ"}</span></button>{desc(`K${i}`, text)}</div>)}<p className={`${styles.muted} ${styles.note}`}>Корабль, маршрут, еда и развлечения одинаковы для всех кают — разница только в самой каюте.</p></div><div className={styles.card}><h3>Маршрут</h3>{CRUISE_PORTS.map((port, i) => <div className={styles.port} key={port}><span className={styles.dot}>{i === 5 ? "↩" : i + 1}</span><span>{["🇮🇹", "🇪🇸", "🇪🇸", "🇫🇷", "🇮🇹", "🇮🇹"][i]} {port}</span></div>)}<p className={styles.muted}>Корабль переезжает ночью, а утром ты просыпаешься в новом городе. Вещи распаковываешь один раз.</p>{index >= 12 ? <div className={styles.ok}>✓ Маршрут изучен</div> : <button type="button" className={`${styles.btn} ${styles.dark}`} data-todo={cabinsRead >= 4 || undefined} onClick={routeQuiz}>Проверь себя</button>}</div></>,
    guests: <>{phoneHeader}<div className={styles.card}><h3>Выберите, как вы хотите продолжить своё бронирование</h3><p className={styles.muted}>Укажите всех пассажиров — и членов клуба inCruises, и тех, кто не в клубе. Возраст будет рассчитан на дату посадки 2027-09-01.</p>{GUEST_LABELS.map(([label, age], i) => <div className={styles.cnt} key={label}><div><strong>{label}</strong><div className={styles.muted}>{age}</div></div><div className={styles.ctl}><button type="button" aria-label={`Уменьшить: ${label}`} disabled={busy || guests[i] === 0} onClick={() => setGuests((old) => old.map((n, j) => i === j ? n - 1 : n))}>−</button><output aria-label={label}>{guests[i]}</output><button type="button" aria-label={`Добавить: ${label}`} disabled={busy || guests[i] === 8} onClick={() => setGuests((old) => old.map((n, j) => i === j ? n + 1 : n))}>+</button></div></div>)}<div className={styles.tip}>💡 С тобой могут ехать все — даже те, кто не в клубе.<br />🎂 Возраст считается на дату посадки, а не на сегодня.</div><button type="button" className={styles.btn} data-next onClick={guestsNext}>Продолжить →</button></div></>,
    cabin: <>{phoneHeader}<div className={styles.card}><div className={styles.muted}>Шаг 2 из 8</div><h3>Выберите категорию каюты</h3><div className={styles.pbar}><i style={{ width: "25%" }} /></div><div className={styles.tabs}>{CRUISE_CABINS.map(([, label], i) => <button type="button" className={`${styles.tab} ${i === 1 ? styles.tabOn : ""}`} key={label} onClick={() => i !== 1 && setToast("В тренажёре пример только для «С видом на море»")}>{label}</button>)}</div><div className={`${styles.muted} ${styles.note}`}>Пример: 2 взрослых + 2 детей</div>{[["Deluxe Ocean View", "$5,564.48"], ["Infinite Ocean View", "$5,846.08"]].map(([label, price], i) => <button type="button" className={styles.opt2} disabled={busy || index < 14} key={label} data-next={i === 0 || undefined} onClick={() => chooseCabin(i)}><span><span>{label}</span><span className={styles.muted}>Начало в </span><b>{price}</b></span><span className={styles.chevron}>›</span></button>)}<p className={`${styles.muted} ${styles.note}`}>Infinite Ocean View у MSC — каюта с большим окном, которое частично опускается: почти балкон.</p></div></>,
    twist: attempt?.screenshotSent ? <div className={`${styles.card} ${styles.center}`} role="status"><div className={styles.big}>🏅</div><h3>Достижение «Капитан-разведчик»</h3><p>Задание выполнено! Ты заработал(а) <b>{miles(attempt.earnedPoints)}</b></p><p className={styles.muted}>Наставник увидит твой круиз и поможет со следующим шагом.</p></div> : <><div className={`${styles.card} ${styles.center}`}><div className={styles.big}>🎉</div><h3>Это была тренировка!</h3><p>{attempt?.trainingDone ? <>Ты прошёл(ла) весь путь капитана и заработал(а) <b>{miles(attempt.earnedPoints)}</b></> : "Тренировка пройдена. Осталось сохранить завершение и начислить мили."}</p><p className={styles.recap}>✓ В клубе <b>{CRUISE_LINE_COUNT} круизных линий</b> — морские и речные<br />✓ Каюты бывают 4 видов: внутренняя, с видом на море, балкон, сюита<br />✓ Цену на семью кабинет считает сам<br />✓ Даты: сначала месяц, потом день</p>{!attempt?.trainingDone && <button type="button" className={styles.btn} disabled={busy} onClick={finish}>{busy ? "Начисляем мили…" : `Получить ${miles(CAPTAIN_TRAINING_REWARD)}`}</button>}</div><div className={styles.card}><h3>⚓ Теперь — настоящее плавание</h3><ol className={styles.steps}><li>Открой <a href="https://www.incruises.com" target="_blank" rel="noopener noreferrer">incruises.com ↗</a> и войди в свой кабинет</li><li>Нажми <b>«Забронировать круиз»</b></li><li>Выбери направление (можно ⭐ Средиземное море)</li><li>Найди круиз и нажми <b>«Book Cruise»</b></li><li>Добавь своих близких и выбери каюту</li><li>Сделай <b>скриншот</b> с ценой — бронировать и платить не нужно</li><li>Нажми «Отправить наставнику»: откроется бот — прикрепи скриншот, текст добавится сам</li></ol><form onSubmit={(event) => { event.preventDefault(); void openTelegram(); }}>{([["direction", "Направление", "Например, Средиземное море"], ["line", "Круизная линия", "например, MSC Cruises"], ["who", "Кто едет", "2 взрослых и 2 детей"], ["price", "Цена за всех", "$"]] as const).map(([key, label, placeholder]) => <label className={styles.lbl} key={key}>{label}<input value={details[key]} maxLength={120} required disabled={busy} placeholder={placeholder} onChange={(event) => { setDetails((old) => ({ ...old, [key]: event.target.value })); setNotice(""); }} /></label>)}<div className={styles.msg}>{captainMessage({ direction: details.direction || "___", line: details.line || "___", who: details.who || "___", price: details.price || "___" })}</div><button type="button" className={`${styles.btn} ${styles.dark}`} disabled={!detailsReady} onClick={() => void copyMessage()}>📋 Копировать</button>{alert}{notice && <p className={styles.expl} role="status">{notice}</p>}<button type="submit" className={`${styles.btn} ${styles.green}`} data-next disabled={busy || !detailsReady || !attempt?.trainingDone}>{busy ? "Подготавливаем…" : linkRequired ? "Привязать Telegram" : "📤 Отправить наставнику · +1 ✈️"}</button><button type="button" className={styles.save} disabled={busy || !detailsReady || !attempt?.trainingDone} onClick={() => void run(() => captainAction(taskId, "save-details", undefined, { details }), () => setNotice("Данные сохранены. Можешь вернуться к отправке позже."))}>Сохранить и отправить позже</button><p className={styles.note}>В Telegram нажми Start и отправь одно фото. Текст добавится автоматически. +1 миля начислится за скриншот, а не за переход.</p></form></div></>,
  };
  const progress = Math.round(ROUTE.indexOf(screen === "lines" || screen === "dest" ? "search" : screen) / (ROUTE.length - 1) * 100);
  if (material) return <section className={styles.game} aria-label={`Материал игры ${CAPTAIN_CRUISE_TITLE}`}><CaptainCruiseMaterial onBack={() => setMaterial(false)} /></section>;
  return <section className={styles.game} aria-label={`Тренировка ${CAPTAIN_CRUISE_TITLE}`} data-captain-screen={screen}>
    <div className={styles.wrap} inert={quizIndex !== null}><header className={styles.top}><div className={styles.mrow}><span>🚢 {CAPTAIN_CRUISE_TITLE}</span><span className={styles.m}>✈️ {earned} из {CAPTAIN_CRUISE_REWARD}</span></div><div className={styles.pbar} role="progressbar" aria-label="Прогресс тренировки" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div></header><div ref={content} tabIndex={-1}>{screen === "intro" || screen === "twist" ? body[screen] : <div className={styles.phone}>{body[screen]}</div>}{screen !== "twist" && quizIndex === null && alert}{screen === "twist" && attempt?.trainingDone && <MaterialButton onClick={() => setMaterial(true)} />}</div><p className={styles.note}>Учебные цены и списки взяты из тренажёра. Актуальные условия проверяй в своём кабинете inCruises.</p>
      <div className={`${styles.taskbar} ${task.done ? styles.taskDone : ""}`} role="status"><div className={styles.tt}>{task.n !== undefined && <b>{task.done ? "✅" : "🧭"} Задание {task.n}. </b>}{task.done ? task.doneText || task.text : task.text}</div><div className={styles.tb}><span className={styles.dots}>{dots}</span>{!(screen === "twist" && attempt?.screenshotSent) && <button type="button" className={styles.show} onClick={showLeft}>{task.done || !task.progress ? "Покажи, куда нажать ↓" : "Покажи, что осталось ↓"}</button>}</div></div>
    </div>
    {stage && <div className={styles.modal}><div ref={sheet} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={`${id}-question`} tabIndex={-1} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
      if (event.key !== "Tab") return;
      event.stopPropagation();
      const controls = Array.from(sheet.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}><div className={styles.qh}>🧭 Вопрос капитана{stage.miles > 0 && ` · +${stage.miles} ✈️`}</div><h3 className={styles.qq} id={`${id}-question`}>{stage.title}</h3>{stage.options.map((option, i) => <button type="button" className={`${styles.opt} ${selected === i ? feedback === "incorrect" ? styles.bad : feedback === "correct" ? styles.correct : "" : ""}`} key={option} disabled={busy || Boolean(feedback)} aria-pressed={selected === i} onClick={() => answer(i)}>{option}</button>)}{feedback === "correct" && <><div className={styles.expl} role="status">✅ {stage.explanation}</div><button type="button" className={styles.btn} onClick={nextQuiz}>Дальше →</button></>}{feedback === "incorrect" && <div className={styles.hintw} role="alert">Не совсем 🙂 Попробуй ещё раз<button type="button" className={`${styles.btn} ${styles.dark}`} disabled={busy} onClick={() => void run(() => captainAction(taskId, "retry", quizIndex!), () => { setFeedback(""); setSelected(null); })}>Попробовать ещё раз</button></div>}{alert}</div></div>}
    {toast && <div className={styles.toast} role="status">{toast}</div>}
  </section>;
}
