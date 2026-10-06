"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Submission } from "@/shared/domain/types";
import { firstYearAction } from "@/frontend/shared/api/first-year-client";
import {
  applyFirstYear, FIRST_YEAR_GOAL, FIRST_YEAR_MONTHS, FIRST_YEAR_MOTIVATION, FIRST_YEAR_REWARD, replayFirstYear, type FirstYearChoice, type FirstYearState,
} from "@/shared/domain/first-year";
import styles from "./FirstYearGame.module.css";

type Screen =
  | { kind: "intro" }
  | { kind: "month" }
  | { kind: "result"; choice: FirstYearChoice; delta: number; was: number; now: number }
  | { kind: "finale" };

// The month text and the note under it, word for word from the original game.
function copy(month: number, state: FirstYearState): { text: string; note: string; balance?: boolean } {
  switch (month) {
    case 1: return { text: "Ты вступил в клуб на плане CLASSIC и сразу получил 350 баллов. Каждый месяц будет приходить счёт на $100.", note: "Как будешь платить?" };
    case 2: return { text: "Пришёл счёт за членство. А зарплату дадут только 8-го числа.", note: state.autopay ? "У тебя автоплатёж: он спишет взнос, если на карте будут деньги." : "Автоплатежа нет — решать тебе." };
    case 3: return { text: "«Это пирамида! Твои деньги пропадут, вот увидишь».", note: "Что сделаешь?" };
    case 4: return { text: "Вышел новый телефон. Мысль: «Пропущу пару месяцев членства, потом вернусь».", note: "", balance: true };
    case 5: return { text: "Баллы копятся, но ничего не происходит. Энтузиазм падает.", note: "Что сделаешь?" };
    case 6: return { text: "Сломалась машина — ремонт $300. Денег впритык.", note: "Это месяц, когда уходят чаще всего. Решение — твоё." };
    case 7: return { text: state.points >= FIRST_YEAR_GOAL ? `Ура! У тебя ${state.points} баллов — цель достигнута! Нашёлся круиз мечты с отплытием через 2 месяца.` : `До цели осталось ${FIRST_YEAR_GOAL - state.points} баллов. Пока копишь — присматриваешь круиз с отплытием через 2 месяца.`, note: "Можно ли забронировать его с баллами?" };
    case 8: return { text: "Круиз стоит $3 000 на двоих. Сколько баллов можно списать?", note: "Выбери ответ:" };
    case 9: return { text: "Бронь подтверждена. Мысль: «Теперь можно перестать платить членство».", note: "Так можно?" };
    case 10: return { text: "Ты на борту! Что из этого было оплачено баллами?", note: "Выбери ответ:" };
    case 11: return { text: "Загар, фото, впечатления. Хочется ещё.", note: "Что дальше?" };
    default: return { text: "Год в клубе подходит к концу.", note: "Оплати последний взнос года:" };
  }
}

/** Lessons contain only <b> emphasis from our own texts; render them as rich text safely. */
function Rich({ html, as: Tag = "span", className }: { html: string; as?: "span" | "p" | "div"; className?: string }) {
  const parts = html.split(/(<b>.*?<\/b>)/g).filter(Boolean);
  return <Tag className={className}>{parts.map((part, index) => part.startsWith("<b>") ? <b key={index}>{part.slice(3, -4)}</b> : part)}</Tag>;
}

export function FirstYearGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const [state, setState] = useState<FirstYearState>(() => replayFirstYear([]));
  const [choices, setChoices] = useState<number[]>([]);
  const [month, setMonth] = useState(1);
  const [screen, setScreen] = useState<Screen>({ kind: "intro" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rewarded, setRewarded] = useState(false);
  const [replay, setReplay] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const top = useRef<HTMLDivElement>(null);
  // Where the bottom of the card was on screen when the participant tapped; the next card is placed the same way.
  const anchor = useRef<number | null>(null);
  function keepPlace() {
    const card = top.current?.querySelector<HTMLElement>("[data-card]");
    anchor.current = card ? card.getBoundingClientRect().bottom : null;
  }
  useLayoutEffect(() => {
    if (anchor.current === null) return;
    const card = top.current?.querySelector<HTMLElement>("[data-card]");
    const shift = card ? card.getBoundingClientRect().bottom - anchor.current : 0;
    anchor.current = null;
    if (!shift) return;
    const scroller = top.current?.closest<HTMLElement>("[data-modal-scroll]");
    if (scroller) scroller.scrollTop += shift; else window.scrollBy(0, shift);
  }, [screen, month]);

  useEffect(() => {
    let active = true;
    firstYearAction(taskId, "start").then((attempt) => {
      if (!active) return;
      if (attempt.completed) { setRewarded(true); setChoices(attempt.choices); setState(replayFirstYear(attempt.choices)); setMonth(12); setScreen({ kind: "finale" }); }
      else if (attempt.choices.length) {
        // Resume where the year stopped.
        setChoices(attempt.choices); setState(replayFirstYear(attempt.choices));
        setMonth(Math.min(12, attempt.choices.length + 1)); setScreen(attempt.choices.length >= 12 ? { kind: "finale" } : { kind: "month" });
      }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Не удалось открыть игру."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [taskId]);

  // Finishing the year: the site checks the twelve choices and adds the miles (once, even if the screen re-renders).
  const completing = useRef(false);
  useEffect(() => {
    if (screen.kind !== "finale" || rewarded || replay || choices.length !== 12 || completing.current) return;
    completing.current = true;
    firstYearAction(taskId, "complete").then((attempt) => {
      setRewarded(true);
      if (attempt.submission) onCompleted?.(attempt.submission);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось завершить игру."))
      .finally(() => { completing.current = false; setBusy(false); });
    // Shown as "Начисляем мили…" while the request runs.
    const timer = window.setTimeout(() => setBusy(completing.current), 0);
    return () => window.clearTimeout(timer);
  }, [screen.kind, rewarded, replay, choices.length, taskId, onCompleted]);

  // Answers change the card in place, so the page stays where the participant tapped.
  // Only the long year summary is shown from its beginning.
  useEffect(() => {
    if (screen.kind !== "finale") return;
    const card = top.current?.querySelector<HTMLElement>("[data-finale]");
    if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [screen.kind]);

  // The points fall in front of the player's eyes when they leave the club.
  useEffect(() => {
    if (screen.kind !== "result" || screen.choice.effect !== "fail") return;
    const { was, now } = screen;
    let frame = 0, started = 0;
    const step = (time: number) => {
      if (!started) started = time;
      const progress = Math.min(1, (time - started) / 1500);
      setShown(Math.round(was - (was - now) * progress));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [screen]);

  function choose(index: number) {
    keepPlace();
    const next: FirstYearState = { ...state, marks: { ...state.marks } };
    const was = state.points;
    const { delta, choice } = applyFirstYear(next, month, index);
    if (!choice) return;
    if (choice.effect === "fail") {
      // Leaving the club keeps only the paid contributions active; the player can go back and choose again.
      setShown(was); setScreen({ kind: "result", choice, delta: 0, was, now: 100 * (month - 1) });
      return;
    }
    const nextChoices = [...choices.slice(0, month - 1), index];
    setState(next); setChoices(nextChoices); setError("");
    setScreen({ kind: "result", choice, delta, was, now: next.points });
    if (!replay && !rewarded) void firstYearAction(taskId, "save", month, nextChoices).catch((cause) => setError(cause instanceof Error ? cause.message : "Прогресс не сохранился. Проверьте интернет."));
  }
  function nextMonth() { keepPlace(); setMonth((value) => value + 1); setScreen({ kind: "month" }); }
  function restart(again = false) {
    setState(replayFirstYear([])); setChoices([]); setMonth(1); setShown(null); setError("");
    if (again) setReplay(true);
    setScreen({ kind: "intro" });
  }

  if (loading) return <div className={styles.game}><p className={styles.loading}>Загружаем игру…</p></div>;
  const fallen = screen.kind === "result" && screen.choice.effect === "fail";
  const points = fallen ? shown ?? state.points : state.points;
  const current = FIRST_YEAR_MONTHS[month - 1];

  return <div className={styles.game} ref={top}>
    <header className={styles.header}><h3>⚓ Мой первый год в клубе</h3><p>12 месяцев — одна игра</p></header>
    {screen.kind !== "intro" && <div className={styles.hud}>
      <div className={styles.hudRow}>
        <div><small>Баллы клуба</small><div className={`${styles.points} ${fallen ? styles.red : ""}`}>{points} <small>/ {FIRST_YEAR_GOAL}</small></div></div>
        <div className={styles.monthBox}><small>Месяц</small><b>{Math.min(month, 12)} из 12</b></div>
      </div>
      <div className={styles.bar}><i style={{ width: `${Math.min(100, (points / FIRST_YEAR_GOAL) * 100)}%` }} /></div>
      <div className={styles.ports} aria-hidden="true">{Array.from({ length: 12 }, (_, index) => {
        const number = index + 1;
        const mark = state.marks[number];
        return <span key={number} className={[styles.port, mark === "done" ? styles.done : "", mark === "late" ? styles.late : "", number === state.goalMonth ? styles.goal : "", number === month && screen.kind !== "finale" ? styles.now : ""].join(" ")}>{number === state.goalMonth ? "★" : number}</span>;
      })}</div>
    </div>}

    {error && <p className={styles.error} role="alert">{error}</p>}

    {screen.kind === "intro" && <div className={styles.card}>
      <div className={styles.emoji}>🌊</div>
      <h4>Проживи первый год в клубе за 7 минут</h4>
      <p>Твоя цель — круиз по Средиземноморью за <b>$3 000 на двоих</b>. Баллами можно оплатить половину, значит нужно накопить <b>1 500 баллов</b>.</p>
      <div className={styles.note}>Ты на плане CLASSIC: взнос $100 в месяц. Каждый месяц — новая ситуация из жизни. Баллы в игре — это имитация баллов клуба inCruises. За прохождение на сайте ты получишь <b>{FIRST_YEAR_REWARD} мили</b>.</div>
      {replay && <div className={styles.note}>Это повторное прохождение: мили уже начислены.</div>}
      <button type="button" className={`${styles.btn} ${styles.sun}`} onClick={() => setScreen({ kind: "month" })}>Поднять якорь ⚓</button>
    </div>}

    {screen.kind === "month" && current && <div className={styles.card} key={month} data-card>
      <span className={styles.tag}>Месяц {month}</span>
      <div className={styles.emoji}>{current.emoji}</div>
      <h4>{current.title}</h4>
      <p>{copy(month, state).text}</p>
      {copy(month, state).balance ? <div className={styles.balance}><span>Твой баланс сейчас</span><b>{state.points}</b></div>
        : copy(month, state).note && <div className={styles.note}>{copy(month, state).note}</div>}
      <div className={styles.choices}>{current.choices.map((choice, index) => <button type="button" key={choice.label} className={styles.choice} onClick={() => choose(index)}>{choice.label}</button>)}</div>
    </div>}

    {screen.kind === "result" && <div className={styles.card} data-card>
      <span className={styles.tag}>Месяц {month}</span>
      {screen.delta > 0 && <div className={`${styles.delta} ${screen.choice.effect === "late" ? styles.warn : styles.good}`}>+{screen.delta} баллов</div>}
      {screen.choice.effect === "right" || screen.choice.effect === "wrong"
        ? <div className={`${styles.verdict} ${screen.choice.effect === "right" ? styles.ok : styles.no}`}>{screen.choice.head}</div>
        : <h4>{screen.choice.head}</h4>}
      {fallen && <div className={styles.drop}>
        <div className={styles.dropWas}>{screen.was}</div><div className={styles.dropNow}>{shown ?? screen.was}</div>
        <div className={styles.lost}>−{screen.was - screen.now} баллов ушли в неактивный баланс</div>
        <small>Активными остаются только баллы на сумму внесённых взносов</small>
      </div>}
      <Rich html={screen.choice.lesson} as="div" className={styles.lesson} />
      {!fallen && state.goalMonth === month && <div className={styles.reward}>🎉 <b>Цель достигнута!</b> У тебя {state.points} баллов — хватает на круиз мечты.</div>}
      {!fallen && screen.delta > 0 && FIRST_YEAR_MOTIVATION[month] && <div className={styles.motiv}><i>{FIRST_YEAR_MOTIVATION[month][0]}</i><p>{FIRST_YEAR_MOTIVATION[month][1]}</p></div>}
      {fallen ? <>
        <button type="button" className={styles.btn} onClick={() => { keepPlace(); setShown(null); setScreen({ kind: "month" }); }}>↩ Вернуться и выбрать иначе</button>
        <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => restart(replay)}>Начать заново</button>
      </> : month >= 12
        ? <button type="button" className={`${styles.btn} ${styles.sun}`} onClick={() => setScreen({ kind: "finale" })}>Посмотреть итоги года</button>
        : <button type="button" className={styles.btn} onClick={nextMonth}>Следующий месяц →</button>}
    </div>}

    {screen.kind === "finale" && <Finale state={state} busy={busy} rewarded={rewarded} replay={replay} onAgain={() => restart(true)} />}
  </div>;
}

function Finale({ state, busy, rewarded, replay, onAgain }: { state: FirstYearState; busy: boolean; rewarded: boolean; replay: boolean; onAgain: () => void }) {
  const spent = state.goalMonth ? FIRST_YEAR_GOAL : 0;
  const title = state.late === 0 ? `Ты доплыл до мечты в месяце ${state.goalMonth}!` : `Ты доплыл, но позже — в месяце ${state.goalMonth}`;
  const text = state.late === 0 ? "Все взносы — вовремя. Удвоение сработало на 100%." : `Из-за оплат с опозданием (${state.late}) ты потерял ${state.late * 100} баллов и дошёл до цели позже, чем мог бы — в месяце 7.`;
  return <div className={styles.card} data-finale>
    <div className={styles.emoji}>🏆</div>
    <h4>{title}</h4>
    <p>{text}</p>
    <div className={styles.sum}>
      <div><b>$1300</b><span>внесено за год</span></div>
      <div><b>{state.points}</b><span>баллов получено</span></div>
      <div><b>{spent}</b><span>баллов ушло на круиз</span></div>
      <div><b>{state.points - spent}</b><span>осталось на следующий</span></div>
    </div>
    <div className={styles.motiv}><i>💎</i><p>Ты накопил не {state.points} баллов. Ты накопил привычку человека, у которого мечты сбываются по расписанию.</p></div>
    <div className={styles.note}>Ответы на вопросы о правилах: <b>{state.correct} из {state.quizzes}</b>{state.correct < state.quizzes ? " — пройди ещё раз, чтобы запомнить все правила." : " — ты знаешь правила клуба!"}</div>
    <div className={styles.secret}>
      <div className={styles.secretHead}>🤫 А теперь секрет капитана</div>
      <p>За год ты отдал <b>$1 200</b> членских взносов. А есть люди в клубе, которые получают те же <b>200 баллов каждый месяц</b> — и при этом <b>не платят свои $100</b>.</p>
      <div className={styles.vs}>
        <div><span>Ты сейчас</span><b>−$1 200</b><small>в год за членство</small></div>
        <div className={styles.win}><span>Партнёр</span><b>$0</b><small>а баллы те же</small></div>
      </div>
      <p>Это называется <b>бесплатное членство</b>. Его получают партнёры клуба. Путешествуешь так же — только твоя мечта больше не стоит тебе $100 в месяц.</p>
      <p><b>Как это сделать — узнаешь на следующем шаге программы.</b> Капитан, курс на свободу! ⚓</p>
    </div>
    <div className={styles.reward} role="status">
      {replay ? <>✈️ Мили за эту игру уже начислены.</> : busy ? <>Начисляем мили…</> : rewarded ? <>✈️ <b>+{FIRST_YEAR_REWARD} мили</b> за прохождение игры — начислены! Следующий шаг программы уже открыт.</> : <>✈️ <b>+{FIRST_YEAR_REWARD} мили</b> за прохождение игры</>}
    </div>
    <h4 className={styles.small}>Проверь в своём кабинете inCruises</h4>
    <ol className={styles.task}>
      <li>Найди дату своего счёта за членство.</li>
      <li>Проверь, подключён ли автоплатёж.</li>
      <li>Посмотри свой баланс баллов.</li>
    </ol>
    <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={onAgain}>Сыграть ещё раз</button>
  </div>;
}
