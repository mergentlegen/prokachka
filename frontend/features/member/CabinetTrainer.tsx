"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import type { Submission } from "@/shared/domain/types";
import { cabinetTrainerAction, type TrainerStats } from "@/frontend/shared/api/cabinet-trainer-client";
import { trainerErrorLabel, type CabinetTrainer as Trainer, type TrainerMission } from "@/shared/domain/cabinet-trainer";
import { formatMiles } from "@/frontend/shared/lib/format";
import { Bold, MaterialButton, TrainerMaterial } from "./GameMaterial";
import styles from "./CabinetTrainer.module.css";

// The engine of cabinet trainers (shared/domain/cabinet-trainer.ts): a copy of the club cabinet with missions —
// tap the right place, sometimes several in a row, sometimes answer a question — then a check where a mistake takes
// one question back, the results and the miles. The colours and texts follow the author's trainers; each trainer
// draws its own cabinet screens with `render`. The site keeps the progress and gives the miles once.
type Screen = "intro" | "sim" | "quiz" | "review" | "done";
export type TrainerMenu = "open" | "pay" | "closed";
const NO_STATS: TrainerStats = { errors: 0, hints: 0, log: {} };
// The training timers: the calendar month and the personal month end at made-up moments after opening.
const CALENDAR_LEFT = ((15 * 24 + 9) * 60 + 25) * 60000 + 8000;
const PERSONAL_LEFT = ((18 * 24 + 17) * 60 + 32) * 60000 + 57000;

/** What a trainer's cabinet screens get from the engine. */
export type CabinetView = {
  view: string; menu: TrainerMenu;
  /** The class of a place to tap: it pulses when the engine points at it. */ spot: (name: string) => string;
  /** The countdowns, in ms. */ calendarLeft: number; personalLeft: number;
  /** Props of the wide table that has to be scrolled (mission target `scroll`). */
  table: { ref: RefObject<HTMLDivElement | null>; onScroll: () => void; onMouseDown: (event: MouseEvent<HTMLDivElement>) => void };
};

export function Timer({ left }: { left: number }) {
  let seconds = Math.max(0, Math.floor(left / 1000));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  return <div className={styles.timer}>{([[days, "Дни"], [hours, "Часов"], [minutes, "Минуты"], [seconds, "Секунд"]] as const).map(([value, label]) =>
    <div key={label}><b>{value}</b><span>{label}</span></div>)}</div>;
}

/** The cabinet header with the menu button (a place to tap: `burger`). */
export function cabinetHeader(cabinet: CabinetView, title: string) {
  return <div className={styles.hdr}>
    <span className={`${styles.burger} ${cabinet.spot("burger")}`} data-hot="burger" role="img" aria-label="Меню"><i /><i /><i /></span>
    <div className={styles.hdrTitle}>{title}</div>
    <div className={styles.ava} aria-hidden="true" />
  </div>;
}

/** The main page of the cabinet: two countdowns and the card «Прямой объём по членству». */
/** `people`: the avatars and the sum are places of their own (`avatars`, `money`); otherwise the card is one place. */
export function cabinetHome(cabinet: CabinetView, people: readonly { key: string; initials: string; color: string }[], separate: boolean) {
  return <div>
    {cabinetHeader(cabinet, "Добро пожаловать")}
    <div className={styles.h2}>Обратные отсчёты</div>
    <div className={`${styles.card} ${cabinet.spot("timerCal")}`} data-hot="timerCal">
      <Timer left={cabinet.calendarLeft} />
      <div className={styles.cap}>До конца месяца</div>
    </div>
    <div className={`${styles.card} ${cabinet.spot("timerPers")}`} data-hot="timerPers">
      <Timer left={cabinet.personalLeft} />
      <div className={styles.cap}>Пока не отправлен счёт на оплату членства в клубе</div>
    </div>
    <div className={`${styles.card} ${cabinet.spot("direct")}`} data-hot="direct">
      <div className={styles.ctitle}>Прямой объём по членству <span className={styles.info} aria-hidden="true">i</span></div>
      <div className={styles.bar}><i style={{ width: "90%" }} /></div>
      <div className={styles.avs}>
        <div className={`${styles.stack} ${separate ? cabinet.spot("avatars") : ""}`} data-hot={separate ? "avatars" : undefined}>
          {people.map((person) => <span key={person.key} style={{ background: person.color }}>{person.initials}</span>)}
        </div>
        <div className={`${styles.money} ${separate ? cabinet.spot("money") : ""}`} data-hot={separate ? "money" : undefined}>$450 / $500</div>
      </div>
    </div>
    <div className={styles.h2} style={{ fontSize: 20 }}>Оставайтесь в курсе</div>
    <div className={styles.news}>inCruises · новости клуба</div>
  </div>;
}

export function CabinetTrainer({ taskId, trainer, render, onCompleted }: { taskId: string; trainer: Trainer;
  /** The trainer's cabinet screens (and menu), drawn for the current mission. */ render: (cabinet: CabinetView) => ReactNode;
  onCompleted?: (submission: Submission) => void }) {
  const missionCount = trainer.missions.length;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [screen, setScreen] = useState<Screen>("intro");
  const [material, setMaterial] = useState(false);
  // Missions the site has accepted. After the miles the trainer can be replayed as practice: nothing is sent then.
  const [saved, setSaved] = useState(0);
  const [rewarded, setRewarded] = useState(false);
  const [practice, setPractice] = useState(false);
  const [sending, setSending] = useState(false);
  const [stats, setStats] = useState<TrainerStats>(NO_STATS);
  const [mission, setMission] = useState(0);
  // Taps already done in a mission of several taps (open the menu, then «Платежи»…).
  const [step, setStep] = useState(0);
  const [view, setView] = useState("home");
  const [menu, setMenu] = useState<TrainerMenu>("closed");
  const [briefing, setBriefing] = useState(false);
  const [popup, setPopup] = useState<TrainerMission | null>(null);
  // `wrong` flashes red for a moment; the explanation stays until the right answer, as in the original.
  const [asked, setAsked] = useState<{ wrong: number | null; solved: boolean; why: boolean }>({ wrong: null, solved: false, why: false });
  const [hint, setHint] = useState("");
  const [pulse, setPulse] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [question, setQuestion] = useState(0);
  const [quizPick, setQuizPick] = useState<{ index: number; right: boolean } | null>(null);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const misses = useRef(0);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const timers = useRef<number[]>([]);
  const later = (run: () => void, ms: number) => { timers.current.push(window.setTimeout(run, ms)); };

  useEffect(() => {
    let active = true;
    cabinetTrainerAction(trainer.kind, taskId, "start").then((attempt) => {
      if (!active) return;
      setSaved(attempt.missions); setStats(attempt.stats);
      if (attempt.completed) { setRewarded(true); setScreen("done"); }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Не удалось открыть тренажёр."); })
      .finally(() => { if (active) setLoading(false); });
    const pending = timers.current;
    return () => { active = false; pending.forEach((timer) => window.clearTimeout(timer)); };
  }, [taskId, trainer.kind]);

  // The countdowns of the cabinet copy tick only while it is on screen.
  useEffect(() => {
    if (screen !== "sim") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [screen]);

  // A dragged table must not count as a tap; the mouse can drag it on a computer like a finger on a phone.
  useEffect(() => {
    const move = (event: globalThis.MouseEvent) => {
      const state = drag.current, box = scroller.current;
      if (!state || !box) return;
      const shift = event.clientX - state.x;
      if (Math.abs(shift) > 5) state.moved = true;
      box.scrollLeft = state.left - shift;
    };
    const up = () => { if (drag.current) { dragged.current = drag.current.moved; drag.current = null; window.setTimeout(() => { dragged.current = false; }, 0); } };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  // Every new screen, mission, cabinet page and question starts from the top of the window, as in the original.
  useEffect(() => {
    root.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0 });
  }, [screen, mission, view]);
  useEffect(() => {
    if (briefing || popup) action.current?.focus({ preventScroll: true });
  }, [briefing, popup]);

  const current = trainer.missions[mission];
  const target = current?.seq[step] ?? current?.seq[0];
  const busy = briefing || Boolean(popup) || sending;

  function bump(key: string) {
    setStats((value) => ({ ...value, errors: value.errors + 1, log: { ...value.log, [key]: (value.log[key] || 0) + 1 } }));
  }
  function shake(element: Element | null) {
    if (!element) return;
    element.classList.add(styles.shake);
    later(() => element.classList.remove(styles.shake), 400);
  }
  function show(next: Screen) { setError(""); setScreen(next); }
  function apply(spot: string) {
    const effect = trainer.effects?.[spot];
    if (effect?.menu) setMenu(effect.menu);
    if (effect?.view) setView(effect.view);
  }

  function openMission(index: number) {
    const next = trainer.missions[index];
    misses.current = 0;
    setMission(index); setStep(0); setView(next.view); setMenu("closed"); setHint(""); setPulse(null); setPopup(null);
    if (next.seq[0] === "scroll" && scroller.current) scroller.current.scrollLeft = 0;
    setBriefing(true);
  }
  function start(from: number) {
    show(from >= missionCount ? "quiz" : "sim");
    if (from >= missionCount) { setQuestion(0); setQuizPick(null); return; }
    openMission(from);
  }
  function restart(asPractice: boolean) {
    setPractice(asPractice); setStats(NO_STATS); setMaterial(false); setAsked({ wrong: null, solved: false, why: false });
    start(0);
  }

  function hit(spot: string, element: Element) {
    setPulse(null); setHint(""); misses.current = 0;
    // A middle tap of a chain: the cabinet answers at once and the task at the bottom moves to the next tap.
    if (step + 1 < current.seq.length) {
      apply(spot); setStep(step + 1); setFlash((value) => value + 1);
      return;
    }
    element.classList.add(styles.okflash);
    setSending(true);
    later(() => {
      element.classList.remove(styles.okflash); setSending(false);
      apply(spot);
      setAsked({ wrong: null, solved: false, why: false }); setPopup(current);
    }, 400);
  }
  function miss(spot: string | null, element: Element) {
    misses.current += 1;
    bump(`m${mission + 1}`);
    const known = spot ? current.hints[spot] : undefined;
    setHint(known || (misses.current === 1 ? "Холодно… Посмотри внимательнее." : "Подсветил нужное место — смотри, где мигает ✨"));
    shake(element);
    if (misses.current >= 2) point();
  }
  /** Lights up the place to tap and brings it into view. */
  function point() {
    setPulse(target);
    const place = target === "scroll" ? scroller.current : root.current?.querySelector(`[data-hot="${target}"]`);
    place?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }
  function tap(event: MouseEvent<HTMLDivElement>) {
    if (busy || dragged.current) return;
    const element = event.target as Element;
    if (target === "scroll") {
      const box = scroller.current;
      // A screen wide enough to show the whole table has nothing to scroll: a tap on the table counts then.
      if (box && box.scrollWidth - box.clientWidth <= 0 && box.contains(element)) { hit("scroll", box); return; }
      setHint("Не нажимай — проведи пальцем по таблице справа налево, чтобы пролистать её вправо.");
      return;
    }
    // Anywhere inside the place to find counts, also on a smaller place inside it.
    const found = element.closest(`[data-hot="${target}"]`);
    if (found) { hit(target, found); return; }
    const other = element.closest("[data-hot]");
    // An empty spot of the open menu is not a mistake.
    if (!other && element.closest("[data-no-miss]")) return;
    miss(other?.getAttribute("data-hot") || null, other || element);
  }
  function scrolled() {
    const box = scroller.current;
    if (!box || busy || target !== "scroll") return;
    const max = box.scrollWidth - box.clientWidth;
    if (max > 0 && box.scrollLeft >= max * 0.8) hit("scroll", box);
  }
  function askHint() {
    if (busy) return;
    setStats((value) => ({ ...value, hints: value.hints + 1 }));
    setHint(target === "scroll" ? "Проведи пальцем по таблице справа налево — и она пролистается вправо." : "Смотри, где мигает ✨ — нажми туда.");
    point();
  }

  function answerAsk(option: number) {
    if (!popup?.ask || asked.solved) return;
    if (option === popup.ask.right) { setAsked({ wrong: null, solved: true, why: false }); return; }
    bump(`m${mission + 1}`);
    setAsked({ wrong: option, solved: false, why: true });
    later(() => setAsked((value) => value.wrong === option ? { ...value, wrong: null } : value), 900);
  }
  async function nextMission() {
    if (!popup || sending) return;
    const passed = mission + 1;
    if (!practice && !rewarded) {
      setSending(true); setError("");
      try {
        const attempt = await cabinetTrainerAction(trainer.kind, taskId, "save", passed, { ...(popup.ask ? { answer: popup.ask.right } : {}), ...stats });
        setSaved(attempt.missions);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Прогресс не сохранился. Проверьте интернет и нажмите ещё раз.");
        return;
      } finally { setSending(false); }
    }
    setPopup(null);
    if (passed < missionCount) openMission(passed);
    else start(missionCount);
  }

  function answerQuiz(option: number) {
    if (quizPick) return;
    const item = trainer.quiz[question];
    const right = option === item.right;
    setQuizPick({ index: option, right });
    if (right) {
      later(() => { setQuizPick(null); if (question + 1 < trainer.quiz.length) setQuestion(question + 1); else show("review"); }, 600);
      return;
    }
    // A mistake takes one question back, as in the original trainer.
    bump(`q${question + 1}`);
    later(() => { setQuizPick(null); setQuestion(Math.max(0, question - 1)); }, 1400);
  }
  async function finish() {
    if (practice || rewarded) { show("done"); return; }
    setSending(true); setError("");
    try {
      const attempt = await cabinetTrainerAction(trainer.kind, taskId, "complete", 0, { answers: trainer.quiz.map((item) => item.right), ...stats });
      setRewarded(true); setStats(attempt.stats); show("done");
      if (attempt.submission) onCompleted?.(attempt.submission);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Мили не начислились. Проверьте интернет и нажмите ещё раз."); }
    finally { setSending(false); }
  }

  if (loading) return <div className={styles.game}><p className={styles.loading}>Загружаем тренажёр…</p></div>;
  const errorBox = error && <p className={styles.error} role="alert">{error}</p>;
  const errorLines = Object.entries(stats.log).map(([key, count]) => ({ key, label: trainerErrorLabel(trainer, key), count })).filter((line) => line.label);
  const barText = current?.stepText?.[step] ?? current?.text;

  return <div className={styles.game} ref={root}>
    {screen === "intro" && <section className={styles.pad}>
      {errorBox}
      <div className={styles.kicker}>Тренажёр кабинета</div>
      <h3 className={styles.title}>{trainer.intro.title}</h3>
      <p className={styles.lead}><Bold text={trainer.intro.lead} /></p>
      {trainer.intro.cards.map((card) => <div key={card.title} className={styles.mcard}>
        {card.icon && <div className={styles.ico} aria-hidden="true">{card.icon}</div>}
        <h4>{card.title}</h4>
        <p><Bold text={card.text} /></p>
      </div>)}
      <p className={styles.lead}>Сейчас ты окажешься в копии кабинета. Имена и цифры здесь учебные. Задание всегда будет внизу экрана.</p>
      {saved > 0 && <p className={styles.resume}>{saved >= missionCount ? `Все ${missionCount} миссий пройдены — осталась итоговая проверка.` : `Пройдено миссий: ${saved} из ${missionCount}. Продолжим с того же места.`}</p>}
      <button type="button" className={styles.btn} onClick={() => start(saved)}>
        {saved >= missionCount ? "Перейти к проверке" : saved > 0 ? `Продолжить с миссии ${saved + 1}` : "Начать тренажёр"}
      </button>
    </section>}

    {screen === "sim" && <section className={styles.sim}>
      <div className={styles.cab} onClick={tap}>
        {render({ view, menu, spot: (name) => pulse === name ? styles.pulse : "", calendarLeft: startedAt + CALENDAR_LEFT - now, personalLeft: startedAt + PERSONAL_LEFT - now,
          table: { ref: scroller, onScroll: scrolled, onMouseDown: (event) => { if (scroller.current) drag.current = { x: event.clientX, left: scroller.current.scrollLeft, moved: false }; } } })}
      </div>

      <div className={`${styles.mbar} ${flash ? styles.flash : ""}`} key={flash} role="status">
        <div className={styles.row}><span>Миссия {mission + 1} из {missionCount}</span><span>Ошибок: {stats.errors}</span></div>
        <div className={styles.prog}><i style={{ width: `${(mission / missionCount) * 100}%` }} /></div>
        <div className={styles.mtext}>🎯 {barText}</div>
        {hint && <div className={styles.mhint}>{hint}</div>}
        <button type="button" className={styles.hintBtn} onClick={askHint} disabled={busy}>💡 Подсказка</button>
      </div>

      {briefing && <div className={styles.mintro} role="dialog" aria-modal="true" aria-labelledby={`${trainer.kind}-mission`}>
        <div className={styles.box}>
          <div className={styles.n}>Миссия {mission + 1} из {missionCount}</div>
          <div className={styles.ic} aria-hidden="true">🎯</div>
          <div className={styles.tx} id={`${trainer.kind}-mission`}>{current.text}</div>
          <div className={styles.sm}>Задание останется внизу экрана, пока ты ищешь.</div>
          <button type="button" ref={action} className={`${styles.btn} ${styles.green}`} onClick={() => { setBriefing(false); setFlash((value) => value + 1); }}>Понятно, ищу!</button>
        </div>
      </div>}

      {popup && <div className={styles.pop} role="dialog" aria-modal="true" aria-labelledby={`${trainer.kind}-ok`}>
        <div className={styles.sheet}>
          <h4 id={`${trainer.kind}-ok`}>✅ {popup.ok}</h4>
          <p>{popup.okText}</p>
          {popup.ask && <div className={styles.opts}>
            <div className={styles.askq}>{popup.ask.q}</div>
            {popup.ask.opts.map((option, index) => <button type="button" key={option} ref={index === 0 ? action : undefined} disabled={asked.solved}
              className={`${styles.opt} ${asked.solved && index === popup.ask?.right ? styles.good : ""} ${asked.wrong === index ? styles.bad : ""}`}
              onClick={() => answerAsk(index)}>{option}</button>)}
          </div>}
          {popup.ask && asked.why && <p className={styles.fb} role="alert">{popup.ask.why}</p>}
          {errorBox}
          {(!popup.ask || asked.solved) && <button type="button" ref={popup.ask ? undefined : action} className={styles.btn} disabled={sending} onClick={() => void nextMission()}>{sending ? "Сохраняем…" : "Дальше"}</button>}
        </div>
      </div>}
    </section>}

    {screen === "quiz" && <section className={styles.pad}>
      <div className={styles.kicker}>Проверка · {question + 1} из {trainer.quiz.length}</div>
      <div className={styles.quizq}>{trainer.quiz[question].q}</div>
      <div className={styles.opts}>{trainer.quiz[question].opts.map((option, index) => <button type="button" key={`${question}-${index}`} disabled={Boolean(quizPick)}
        className={`${styles.opt} ${quizPick?.index === index ? (quizPick.right ? styles.good : styles.bad) : ""}`} onClick={() => answerQuiz(index)}>{option}</button>)}</div>
      {quizPick && !quizPick.right && <p className={styles.fb} role="alert">{question > 0 ? "Неверно. Возвращаемся на шаг назад — повтори." : "Неверно. Попробуй ещё раз."}</p>}
    </section>}

    {screen === "review" && <section className={styles.pad}>
      <div className={styles.kicker}>Тренажёр пройден</div>
      <h3 className={styles.title}>Твои итоги</h3>
      <p className={styles.lead} style={{ marginBottom: 6 }}>Ошибок за весь тренажёр:</p>
      <div className={styles.score}>{stats.errors}</div>
      <p className={styles.lead} style={{ textAlign: "center" }}>
        {stats.errors === 0 ? "Идеально! Ты отлично ориентируешься в кабинете." : stats.errors <= 4 ? "Хороший результат. Главное — ты знаешь, куда смотреть." : "Нормально для первого раза. Посмотри, где были ошибки."}
        {stats.hints > 0 && ` Подсказок взято: ${stats.hints}.`}
      </p>
      <div className={styles.mcard}>
        <h4>Где были ошибки</h4>
        <ul className={styles.errList}>{errorLines.length ? errorLines.map((line) => <li key={line.key}>{line.label} — ошибок: {line.count}</li>) : <li>Ошибок нет 👏</li>}</ul>
        <p style={{ marginTop: 12 }}><Bold text={trainer.summary} /></p>
      </div>
      <div className={styles.quizq} style={{ textAlign: "center", marginTop: 18 }}>По ошибкам всё понятно?</div>
      {errorBox}
      <button type="button" className={`${styles.btn} ${styles.green}`} disabled={sending} onClick={() => void finish()}>{sending ? "Начисляем мили…" : "Да, понятно"}</button>
      <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={sending} onClick={() => restart(practice || rewarded)}>Нет, пройду ещё раз</button>
    </section>}

    {screen === "done" && material && <section className={styles.pad}><TrainerMaterial trainer={trainer} onBack={() => setMaterial(false)} /></section>}
    {screen === "done" && !material && <section className={`${styles.pad} ${styles.center}`}>
      <div className={styles.party} aria-hidden="true">🎉</div>
      <h3 className={styles.title}>Тренажёр завершён!</h3>
      {practice ? <p className={styles.lead}>✈️ Мили за этот тренажёр уже начислены — это было повторное прохождение.</p> : <>
        <div className={styles.score}>+{trainer.reward}</div>
        <p className={styles.lead} role="status">✈️ {formatMiles(trainer.reward)} начислены</p>
      </>}
      <p className={styles.lead}>{trainer.doneText}</p>
      {!practice && <p className={styles.next}>Следующий шаг программы уже открыт.</p>}
      <MaterialButton onClick={() => setMaterial(true)} />
      <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => restart(true)}>↻ Пройти ещё раз</button>
    </section>}
  </div>;
}
