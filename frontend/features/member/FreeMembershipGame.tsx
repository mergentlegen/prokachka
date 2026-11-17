"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { Submission } from "@/shared/domain/types";
import { freeMembershipAction, type FreeMembershipStats } from "@/frontend/shared/api/free-membership-client";
import {
  FREE_MEMBERSHIP_INTRO, FREE_MEMBERSHIP_MISSIONS, FREE_MEMBERSHIP_PEOPLE, FREE_MEMBERSHIP_QUIZ, FREE_MEMBERSHIP_REWARD, FREE_MEMBERSHIP_SUMMARY,
  freeMembershipErrorLabel, type FreeMembershipMission,
} from "@/shared/domain/free-membership";
import { formatMiles } from "@/frontend/shared/lib/format";
import { Bold, FreeMembershipMaterial, MaterialButton } from "./GameMaterial";
import styles from "./FreeMembershipGame.module.css";

// «Безоплатное членство»: a copy of the club cabinet with seven missions, then a check of five questions.
// The colours and texts follow the author's trainer; the site keeps the progress and gives the miles once.
type Screen = "intro" | "sim" | "quiz" | "review" | "done";
const MISSIONS = FREE_MEMBERSHIP_MISSIONS.length;
const NO_STATS: FreeMembershipStats = { errors: 0, hints: 0, log: {} };
// The training timers: the calendar month and the personal month end at made-up moments after opening.
const CALENDAR_LEFT = ((15 * 24 + 9) * 60 + 25) * 60000 + 8000;
const PERSONAL_LEFT = ((18 * 24 + 17) * 60 + 32) * 60000 + 57000;

function Timer({ left }: { left: number }) {
  let seconds = Math.max(0, Math.floor(left / 1000));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  return <div className={styles.timer}>{([[days, "Дни"], [hours, "Часов"], [minutes, "Минуты"], [seconds, "Секунд"]] as const).map(([value, label]) =>
    <div key={label}><b>{value}</b><span>{label}</span></div>)}</div>;
}

export function FreeMembershipGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [screen, setScreen] = useState<Screen>("intro");
  const [material, setMaterial] = useState(false);
  // Missions the site has accepted. After the miles the trainer can be replayed as practice: nothing is sent then.
  const [saved, setSaved] = useState(0);
  const [rewarded, setRewarded] = useState(false);
  const [practice, setPractice] = useState(false);
  const [sending, setSending] = useState(false);
  const [stats, setStats] = useState<FreeMembershipStats>(NO_STATS);
  const [mission, setMission] = useState(0);
  const [view, setView] = useState<"home" | "list">("home");
  const [briefing, setBriefing] = useState(false);
  const [popup, setPopup] = useState<FreeMembershipMission | null>(null);
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
    freeMembershipAction(taskId, "start").then((attempt) => {
      if (!active) return;
      setSaved(attempt.missions); setStats(attempt.stats);
      if (attempt.completed) { setRewarded(true); setScreen("done"); }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Не удалось открыть тренажёр."); })
      .finally(() => { if (active) setLoading(false); });
    const pending = timers.current;
    return () => { active = false; pending.forEach((timer) => window.clearTimeout(timer)); };
  }, [taskId]);

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

  // Every new screen, mission card and question starts from the top of the window, as in the original.
  useEffect(() => {
    root.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0 });
  }, [screen, mission]);
  useEffect(() => {
    if (briefing || popup) action.current?.focus({ preventScroll: true });
  }, [briefing, popup]);

  const current = FREE_MEMBERSHIP_MISSIONS[mission];
  const busy = briefing || Boolean(popup) || sending;

  function spotClass(spot: string) { return pulse === spot ? styles.pulse : ""; }
  function bump(key: string, extra: Partial<FreeMembershipStats> = {}) {
    setStats((value) => ({ ...value, ...extra, errors: value.errors + 1, log: { ...value.log, [key]: (value.log[key] || 0) + 1 } }));
  }
  function shake(element: Element | null) {
    if (!element) return;
    element.classList.add(styles.shake);
    later(() => element.classList.remove(styles.shake), 400);
  }
  function show(next: Screen) { setError(""); setScreen(next); }

  function openMission(index: number) {
    const next = FREE_MEMBERSHIP_MISSIONS[index];
    misses.current = 0;
    setMission(index); setView(next.view); setHint(""); setPulse(null); setPopup(null);
    if (next.target === "scroll" && scroller.current) scroller.current.scrollLeft = 0;
    setBriefing(true);
  }
  function start(from: number) {
    show(from >= MISSIONS ? "quiz" : "sim");
    if (from >= MISSIONS) { setQuestion(0); setQuizPick(null); return; }
    openMission(from);
  }
  function restart(asPractice: boolean) {
    setPractice(asPractice); setStats(NO_STATS); setMaterial(false); setAsked({ wrong: null, solved: false, why: false });
    start(0);
  }

  function hit(element: Element) {
    setPulse(null); setHint(""); misses.current = 0;
    element.classList.add(styles.okflash);
    setSending(true);
    later(() => {
      element.classList.remove(styles.okflash); setSending(false);
      if (current.target === "avatars") setView("list");
      setAsked({ wrong: null, solved: false, why: false }); setPopup(current);
    }, 400);
  }
  function miss(spot: string | null, element: Element) {
    misses.current += 1;
    bump(`m${mission + 1}`);
    const known = spot ? current.hints[spot as keyof typeof current.hints] : undefined;
    setHint(known || (misses.current === 1 ? "Холодно… Посмотри внимательнее." : "Подсветил нужное место — смотри, где мигает ✨"));
    shake(element);
    if (misses.current >= 2) point();
  }
  /** Lights up the place to tap and brings it into view. */
  function point() {
    setPulse(current.target);
    const place = current.target === "scroll" ? scroller.current : root.current?.querySelector(`[data-hot="${current.target}"]`);
    place?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }
  function tap(event: MouseEvent<HTMLDivElement>) {
    if (busy || dragged.current) return;
    if (current.target === "scroll") {
      const box = scroller.current;
      // A screen wide enough to show the whole table has nothing to scroll: a tap on the table counts then.
      if (box && box.scrollWidth - box.clientWidth <= 0 && box.contains(event.target as Node)) { hit(box); return; }
      setHint("Не нажимай — проведи пальцем по таблице справа налево, чтобы пролистать её вправо.");
      return;
    }
    const element = (event.target as Element).closest("[data-hot]");
    const spot = element?.getAttribute("data-hot") || null;
    if (element && spot === current.target) { hit(element); return; }
    miss(spot, element || (event.target as Element));
  }
  function scrolled() {
    const box = scroller.current;
    if (!box || busy || current.target !== "scroll") return;
    const max = box.scrollWidth - box.clientWidth;
    if (max > 0 && box.scrollLeft >= max * 0.8) hit(box);
  }
  function askHint() {
    if (busy) return;
    setStats((value) => ({ ...value, hints: value.hints + 1 }));
    setHint(current.target === "scroll" ? "Проведи пальцем по таблице справа налево — и она пролистается вправо." : "Смотри, где мигает ✨ — нажми туда.");
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
        const attempt = await freeMembershipAction(taskId, "save", passed, { ...(popup.ask ? { answer: popup.ask.right } : {}), ...stats });
        setSaved(attempt.missions);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Прогресс не сохранился. Проверьте интернет и нажмите ещё раз.");
        return;
      } finally { setSending(false); }
    }
    setPopup(null);
    if (passed < MISSIONS) openMission(passed);
    else start(MISSIONS);
  }

  function answerQuiz(option: number) {
    if (quizPick) return;
    const item = FREE_MEMBERSHIP_QUIZ[question];
    const right = option === item.right;
    setQuizPick({ index: option, right });
    if (right) {
      later(() => { setQuizPick(null); if (question + 1 < FREE_MEMBERSHIP_QUIZ.length) setQuestion(question + 1); else show("review"); }, 600);
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
      const attempt = await freeMembershipAction(taskId, "complete", 0, { answers: FREE_MEMBERSHIP_QUIZ.map((item) => item.right), ...stats });
      setRewarded(true); setStats(attempt.stats); show("done");
      if (attempt.submission) onCompleted?.(attempt.submission);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Мили не начислились. Проверьте интернет и нажмите ещё раз."); }
    finally { setSending(false); }
  }

  if (loading) return <div className={styles.game}><p className={styles.loading}>Загружаем тренажёр…</p></div>;
  const errorBox = error && <p className={styles.error} role="alert">{error}</p>;
  const errorLines = Object.entries(stats.log).map(([key, count]) => ({ key, label: freeMembershipErrorLabel(key), count })).filter((line) => line.label);

  return <div className={styles.game} ref={root}>
    {screen === "intro" && <section className={styles.pad}>
      {errorBox}
      <div className={styles.kicker}>Тренажёр кабинета</div>
      <h3 className={styles.title}>Безоплатное членство: кто уже оплатил?</h3>
      <p className={styles.lead}>Научимся за 3 минуты проверять в кабинете, подтверждается ли твоё безоплатное членство в этом месяце.</p>
      {FREE_MEMBERSHIP_INTRO.map((card) => <div key={card.title} className={styles.mcard}>
        <div className={styles.ico} aria-hidden="true">{card.icon}</div>
        <h4>{card.title}</h4>
        <p><Bold text={card.text} /></p>
      </div>)}
      <p className={styles.lead}>Сейчас ты окажешься в копии кабинета. Имена и цифры здесь учебные. Задание всегда будет внизу экрана.</p>
      {saved > 0 && <p className={styles.resume}>{saved >= MISSIONS ? "Все 7 миссий пройдены — осталась итоговая проверка." : `Пройдено миссий: ${saved} из ${MISSIONS}. Продолжим с того же места.`}</p>}
      <button type="button" className={styles.btn} onClick={() => start(saved)}>
        {saved >= MISSIONS ? "Перейти к проверке" : saved > 0 ? `Продолжить с миссии ${saved + 1}` : "Начать тренажёр"}
      </button>
    </section>}

    {screen === "sim" && <section className={styles.sim}>
      <div className={styles.cab} onClick={tap}>
        {view === "home" ? <div>
          <div className={styles.hdr}>
            <span className={styles.burger} aria-hidden="true"><i /><i /><i /></span>
            <div className={styles.hdrTitle}>Добро пожаловать</div>
            <div className={styles.ava} aria-hidden="true" />
          </div>
          <div className={styles.h2}>Обратные отсчёты</div>
          <div className={`${styles.card} ${spotClass("timerCal")}`} data-hot="timerCal">
            <Timer left={startedAt + CALENDAR_LEFT - now} />
            <div className={styles.cap}>До конца месяца</div>
          </div>
          <div className={`${styles.card} ${spotClass("timerPers")}`} data-hot="timerPers">
            <Timer left={startedAt + PERSONAL_LEFT - now} />
            <div className={styles.cap}>Пока не отправлен счёт на оплату членства в клубе</div>
          </div>
          <div className={`${styles.card} ${spotClass("direct")}`} data-hot="direct">
            <div className={styles.ctitle}>Прямой объём по членству <span className={styles.info} aria-hidden="true">i</span></div>
            <div className={styles.bar}><i style={{ width: "90%" }} /></div>
            <div className={styles.avs}>
              <div className={`${styles.stack} ${spotClass("avatars")}`} data-hot="avatars">
                {FREE_MEMBERSHIP_PEOPLE.map((person) => <span key={person.key} style={{ background: person.color }}>{person.initials}</span>)}
              </div>
              <div className={`${styles.money} ${spotClass("money")}`} data-hot="money">$450 / $500</div>
            </div>
          </div>
          <div className={styles.h2} style={{ fontSize: 20 }}>Оставайтесь в курсе</div>
          <div className={styles.news}>inCruises · новости клуба</div>
        </div> : <div>
          <div className={styles.lhead}>Члены (Личные) <span className={styles.close} aria-hidden="true">×</span></div>
          <div className={`${styles.scroller} ${spotClass("scroll")}`} ref={scroller} onScroll={scrolled}
            onMouseDown={(event) => { if (scroller.current) drag.current = { x: event.clientX, left: scroller.current.scrollLeft, moved: false }; }}>
            <table className={styles.tbl}>
              <thead><tr><th style={{ width: 230 }}>Имя</th><th style={{ width: 150 }}>Тип членства</th><th style={{ width: 140 }}>Статус</th><th>Сумма</th></tr></thead>
              <tbody>{FREE_MEMBERSHIP_PEOPLE.map((person) => <tr key={person.key}>
                <td><div className={styles.who}><div className={styles.ini} style={{ background: person.color }}>{person.initials}</div>{person.name}</div></td>
                <td className={`${styles.cell} ${spotClass(`type${person.key}`)}`} data-hot={`type${person.key}`}>{person.plan}</td>
                <td>Активный</td>
                <td className={`${styles.cell} ${spotClass(`sum${person.key}`)}`} data-hot={`sum${person.key}`}>{person.sum}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className={styles.swipe}>таблица шире экрана →</div>
        </div>}
      </div>

      <div className={`${styles.mbar} ${flash ? styles.flash : ""}`} key={flash} role="status">
        <div className={styles.row}><span>Миссия {mission + 1} из {MISSIONS}</span><span>Ошибок: {stats.errors}</span></div>
        <div className={styles.prog}><i style={{ width: `${(mission / MISSIONS) * 100}%` }} /></div>
        <div className={styles.mtext}>🎯 {current.text}</div>
        {hint && <div className={styles.mhint}>{hint}</div>}
        <button type="button" className={styles.hintBtn} onClick={askHint} disabled={busy}>💡 Подсказка</button>
      </div>

      {briefing && <div className={styles.mintro} role="dialog" aria-modal="true" aria-labelledby="free-membership-mission">
        <div className={styles.box}>
          <div className={styles.n}>Миссия {mission + 1} из {MISSIONS}</div>
          <div className={styles.ic} aria-hidden="true">🎯</div>
          <div className={styles.tx} id="free-membership-mission">{current.text}</div>
          <div className={styles.sm}>Задание останется внизу экрана, пока ты ищешь.</div>
          <button type="button" ref={action} className={`${styles.btn} ${styles.green}`} onClick={() => { setBriefing(false); setFlash((value) => value + 1); }}>Понятно, ищу!</button>
        </div>
      </div>}

      {popup && <div className={styles.pop} role="dialog" aria-modal="true" aria-labelledby="free-membership-ok">
        <div className={styles.sheet}>
          <h4 id="free-membership-ok">✅ {popup.ok}</h4>
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
      <div className={styles.kicker}>Проверка · {question + 1} из {FREE_MEMBERSHIP_QUIZ.length}</div>
      <div className={styles.quizq}>{FREE_MEMBERSHIP_QUIZ[question].q}</div>
      <div className={styles.opts}>{FREE_MEMBERSHIP_QUIZ[question].opts.map((option, index) => <button type="button" key={`${question}-${index}`} disabled={Boolean(quizPick)}
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
        <p style={{ marginTop: 12 }}><Bold text={FREE_MEMBERSHIP_SUMMARY} /></p>
      </div>
      <div className={styles.quizq} style={{ textAlign: "center", marginTop: 18 }}>По ошибкам всё понятно?</div>
      {errorBox}
      <button type="button" className={`${styles.btn} ${styles.green}`} disabled={sending} onClick={() => void finish()}>{sending ? "Начисляем мили…" : "Да, понятно"}</button>
      <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={sending} onClick={() => restart(practice || rewarded)}>Нет, пройду ещё раз</button>
    </section>}

    {screen === "done" && material && <section className={styles.pad}><FreeMembershipMaterial onBack={() => setMaterial(false)} /></section>}
    {screen === "done" && !material && <section className={`${styles.pad} ${styles.center}`}>
      <div className={styles.party} aria-hidden="true">🎉</div>
      <h3 className={styles.title}>Тренажёр завершён!</h3>
      {practice ? <p className={styles.lead}>✈️ Мили за этот тренажёр уже начислены — это было повторное прохождение.</p> : <>
        <div className={styles.score}>+{FREE_MEMBERSHIP_REWARD}</div>
        <p className={styles.lead} role="status">✈️ {formatMiles(FREE_MEMBERSHIP_REWARD)} начислены</p>
      </>}
      <p className={styles.lead}>Теперь ты знаешь, где в кабинете смотреть свой прямой объём по членству. Загляни туда в своём настоящем кабинете 🙂</p>
      {!practice && <p className={styles.next}>Следующий шаг программы уже открыт.</p>}
      <MaterialButton onClick={() => setMaterial(true)} />
      <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => restart(true)}>↻ Пройти ещё раз</button>
    </section>}
  </div>;
}
