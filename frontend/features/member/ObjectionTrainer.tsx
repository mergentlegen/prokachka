"use client";

import { useEffect, useRef, useState } from "react";
import { trainerAction, type TrainerAttempt } from "@/frontend/shared/api/objection-trainer-client";
import { createCompanyVoiceLink } from "@/frontend/shared/api/ready-program-client";
import { ApiError, createTelegramLink } from "@/frontend/shared/api/client";
import type { ObjectionTrainerData, TrainerRound } from "@/shared/domain/objection-trainer";
import type { Submission } from "@/shared/domain/types";
import { MaterialBar, MaterialButton } from "./GameMaterial";
import styles from "./ObjectionTrainer.module.css";

// Objection trainers for programs («Я подумаю», «Дорого», «Это пирамида»), in the colours of the author's files: dialogue rounds and one
// sorting round. Any option can be tapped — each has its comment. The site checks the first picks (a right one opens
// «Дальше»); once a round is solved, the other options are only shown, nothing more is sent. The mile comes once.
type View = "intro" | "round" | "finish" | "done" | "material";

function viewOf(attempt: TrainerAttempt, rounds: number): View {
  if (attempt.completed) return "done";
  if (attempt.step >= rounds) return "finish";
  return attempt.step === 0 && attempt.mistakes === 0 ? "intro" : "round";
}

/** «раунд», «раунда», «раундов» for the intro line. */
function roundsWord(count: number) {
  const tail = count % 100;
  if (tail > 10 && tail < 20) return "раундов";
  return count % 10 === 1 ? "раунд" : count % 10 >= 2 && count % 10 <= 4 ? "раунда" : "раундов";
}

export function ObjectionTrainer({ trainer, taskId, onCompleted }: { trainer: ObjectionTrainerData; taskId: string; onCompleted?: (submission: Submission) => void }) {
  const rounds = trainer.rounds.length;
  const [attempt, setAttempt] = useState<TrainerAttempt | null>(null);
  const [view, setView] = useState<View>("intro");
  // The round on the screen: after a right pick the site is already one round further, the screen waits for «Дальше».
  const [shown, setShown] = useState(0);
  // Dialogue round: the options tapped (right or not), and the right one once found.
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [solved, setSolved] = useState<number | null>(null);
  // Sorting round: what each phrase shows now (a second tap only changes the screen; the site keeps the first mark).
  const [marks, setMarks] = useState<Record<number, { good: boolean; right: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [linkRequired, setLinkRequired] = useState(false);
  const root = useRef<HTMLElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    trainerAction(trainer.kind, taskId, "start").then((saved) => {
      if (!active) return;
      setAttempt(saved); setShown(Math.min(saved.step, rounds - 1)); setMarks(saved.marks); setView(viewOf(saved, rounds)); setError("");
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Не удалось загрузить тренажёр."); });
    return () => { active = false; };
  }, [taskId, trainer.kind, rounds]);

  useEffect(() => { root.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0 }); }, [view, shown]);

  async function send(operation: "answer" | "mark" | "complete", step: number, payload: { answer?: number } | { item: number; good: boolean } = {}) {
    if (inFlight.current) return null;
    inFlight.current = true; setBusy(true); setError("");
    try { return await trainerAction(trainer.kind, taskId, operation, step, payload); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ответ не сохранился. Проверьте интернет и нажмите ещё раз."); return null; }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function pick(option: number) {
    if (!attempt || option in picked && solved === null) return;
    if (solved !== null) { setPicked((previous) => ({ ...previous, [option]: option === solved })); return; }
    const saved = await send("answer", shown, { answer: option });
    if (!saved) return;
    setAttempt(saved);
    setPicked((previous) => ({ ...previous, [option]: Boolean(saved.right) }));
    if (saved.right) setSolved(option);
  }

  async function mark(item: number, good: boolean) {
    if (!attempt) return;
    const known = marks[item];
    if (known) {
      // The right side is known from the first mark; the second one only shows the other comment.
      const helps = known.right ? known.good : !known.good;
      setMarks((previous) => ({ ...previous, [item]: { good, right: good === helps } }));
      return;
    }
    const saved = await send("mark", trainer.sortStep, { item, good });
    if (!saved) return;
    setAttempt(saved);
    setMarks((previous) => ({ ...previous, [item]: { good, right: Boolean(saved.right) } }));
  }

  function next() {
    if (!attempt) return;
    setPicked({}); setSolved(null);
    if (attempt.step >= rounds) setView("finish");
    else { setShown(attempt.step); setView("round"); }
  }

  async function complete() {
    const saved = await send("complete", 0);
    if (!saved) return;
    if (!saved.completed) { setError("Не удалось подтвердить начисление. Попробуйте ещё раз."); return; }
    setAttempt(saved); setView("done");
    if (saved.submission) onCompleted?.(saved.submission);
  }

  async function voice() {
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
      setNotice("В Telegram нажми «Начать», затем запиши голосовое прямо в чате бота.");
      window.location.assign(target.href);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 422) setLinkRequired(true);
      setError(cause instanceof Error ? cause.message : "Не удалось открыть Telegram.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  const round = trainer.rounds[shown];
  const passed = Boolean(attempt?.completed);
  const stage = view === "intro" ? "Старт" : view === "round" ? `Раунд ${shown + 1} из ${rounds}` : view === "material" ? "Разбор" : "Финиш";
  const progress = view === "intro" ? 0 : view === "round" ? (shown + 1) / (rounds + 1) : 1;
  const allMarked = round?.kind === "sort" && round.phrases.every((_, index) => marks[index]);
  const questionId = `${trainer.kind}-question`;

  const chat = (item: TrainerRound) => item.kind === "chat" && <div className={styles.chat}>{item.chat.map(([who, text]) =>
    <div key={text} className={`${styles.msg} ${who === "client" ? styles.client : styles.me}`}><span className={styles.who}>{who === "client" ? "Клиент" : "Ты"}</span>{text}</div>)}</div>;
  const memo = <>
    <div className={styles.memo}>{trainer.memo[0]}<br />{trainer.memo[1]}</div>
    <p><b>3 шага, которые нужно запомнить:</b></p>
    <ul className={styles.list}>{trainer.steps.map(([name, text]) => <li key={name}><b>{name}:</b> {text}</li>)}</ul>
    {trainer.rules?.map(([name, text]) => <p key={name}><b>{name}:</b> {text}</p>)}
  </>;

  return <section ref={root} className={styles.trainer} aria-label={trainer.title}>
    <div className={styles.wrap}>
      <header className={styles.head}>
        <span className={styles.kicker}>Прокачка · Возражения</span>
        <h3>{trainer.title}</h3>
        <div className={styles.hud}><span>{stage}</span><span>✈️ {passed ? trainer.reward : 0}/{trainer.reward}</span></div>
        <div className={styles.progress} role="progressbar" aria-label="Прогресс тренажёра" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <i style={{ width: `${progress * 100}%` }} />
        </div>
      </header>

      {!attempt && !error && <div className={styles.card}><p>Загружаем тренажёр…</p></div>}

      {attempt && view === "intro" && <div className={styles.card}>
        <span className={styles.round}>Зачем это</span>
        <h4>{trainer.intro.heading}</h4>
        <p>{trainer.intro.lead}</p>
        <ul className={styles.list}>{trainer.intro.reasons.map((reason) => typeof reason === "string"
          ? <li key={reason}>{reason}</li> : <li key={reason[0]}><b>{reason[0]}</b> — {reason[1]}</li>)}</ul>
        {trainer.intro.after && <p>{trainer.intro.after}</p>}
        <p>Пройди {rounds} {roundsWord(rounds)}. Нажимай любые варианты — к каждому есть комментарий: что будет, если сказать так.</p>
        <p className={styles.note}>Пройди до конца — и получишь <b>✈️ {trainer.reward} милю</b>.</p>
        <button type="button" className={`${styles.btn} ${styles.gold}`} onClick={() => setView("round")}>Начать тренировку</button>
      </div>}

      {attempt && view === "round" && round.kind === "chat" && <div className={styles.card}>
        <span className={styles.round}>{round.title}</span>
        {chat(round)}
        <h4 id={questionId}>{round.question}</h4>
        <div className={styles.opts} role="group" aria-labelledby={questionId}>{round.options.map((item, index) => {
          const state = picked[index];
          return <div key={item.text}>
            <button type="button" className={`${styles.opt} ${state === true ? styles.good : state === false ? styles.bad : ""}`}
              disabled={busy} aria-pressed={state !== undefined} onClick={() => void pick(index)}>{item.text}</button>
            {state !== undefined && <div className={`${styles.fb} ${state ? styles.fbGood : styles.fbBad}`} role="status">
              <b>{state ? solved === index ? "Верно!" : "Это правильный ответ" : solved === null ? "Не совсем. Попробуй ещё раз" : "Что будет, если сказать так"}</b>{item.comment}
            </div>}
          </div>;
        })}</div>
        {busy && solved === null && <p className={styles.wait} role="status">Проверяем ответ…</p>}
        {solved !== null && <>
          <p className={styles.hint}>💡 Можешь нажать и на другие варианты — посмотреть, к чему бы они привели.</p>
          <button type="button" className={styles.btn} onClick={next}>Дальше →</button>
        </>}
      </div>}

      {attempt && view === "round" && round.kind === "sort" && <div className={styles.card}>
        <span className={styles.round}>{round.title}</span>
        <h4>{round.question}</h4>
        <div className={styles.sort}>{round.phrases.map((item, index) => {
          const state = marks[index];
          const helps = state && (state.right ? state.good : !state.good);
          return <div key={item.text} className={`${styles.phrase} ${state ? state.right ? styles.phraseGood : styles.phraseBad : ""}`}>
            {item.text}
            <div className={styles.marks} role="group" aria-label={`Фраза ${index + 1}`}>
              <button type="button" disabled={busy} aria-pressed={state?.good === true}
                className={state?.good === true ? state.right ? styles.markGood : styles.markBad : ""} onClick={() => void mark(index, true)}>👍 Помогает</button>
              <button type="button" disabled={busy} aria-pressed={state?.good === false}
                className={state?.good === false ? state.right ? styles.markGood : styles.markBad : ""} onClick={() => void mark(index, false)}>👎 Вредит</button>
            </div>
            {state && <div className={`${styles.fb} ${state.right ? styles.fbGood : styles.fbBad}`} role="status">
              <b>{state.right ? "Верно!" : "Не совсем"}</b>{helps ? "Помогает: " : "Вредит: "}{item.comment}
            </div>}
          </div>;
        })}</div>
        {busy && <p className={styles.wait} role="status">Проверяем ответ…</p>}
        {allMarked && <button type="button" className={styles.btn} onClick={next}>Дальше →</button>}
      </div>}

      {attempt && view === "finish" && <div className={styles.card}>
        <span className={styles.round}>Финиш</span>
        <h4 className={styles.center}>Тренажёр пройден 🎉</h4>
        {memo}
        <button type="button" className={`${styles.btn} ${styles.gold}`} disabled={busy} onClick={() => void complete()}>{busy ? "Начисляем милю…" : `Забрать ✈️ ${trainer.reward} милю`}</button>
      </div>}

      {attempt && view === "done" && <>
        <div className={styles.card}>
          <span className={styles.round}>Финиш</span>
          <h4 className={styles.center}>Тренажёр пройден 🎉</h4>
          <div className={styles.mile}>✈️ +{trainer.reward} миля зачислена!<small>Теперь запиши голосовое наставнику — кнопка ниже</small></div>
          {memo}
        </div>
        <div className={styles.card}>
          <span className={styles.round}>🎙 Закрепи голосом</span>
          <h4>Голосовое на 1 минуту</h4>
          <p>{trainer.voice.task}</p>
          <p className={styles.check}>{trainer.voice.check}</p>
          <button type="button" className={styles.tg} disabled={busy} onClick={() => void voice()}>{busy ? "Открываем Telegram…" : linkRequired ? "Привязать Telegram" : "🎙️ Записать голосовое наставнику"}</button>
          <p className={styles.small}>Голосовое получат наставники твоей ветки. Мили за него не начисляются.</p>
          <p className={styles.small}>Применишь схему в реальном разговоре — напиши в чат команды, что ответил человек.</p>
          <MaterialButton onClick={() => setView("material")} label="Перечитать разбор" />
        </div>
      </>}

      {attempt && view === "material" && <div className={styles.card}>
        <MaterialBar onBack={() => setView("done")} />
        {trainer.rounds.map((item, index) => <div key={item.title} className={styles.read}>
          <span className={styles.round}>{item.title}</span>
          {chat(item)}
          <h4>{item.question}</h4>
          {item.kind === "chat" ? item.options.map((option, optionIndex) => {
            const right = attempt.keys?.answers[index] === optionIndex;
            return <div key={option.text} className={`${styles.opt} ${right ? styles.good : ""}`}>
              {option.text}<span className={styles.comment}><b>{right ? "Правильный ответ. " : ""}</b>{option.comment}</span>
            </div>;
          }) : item.phrases.map((phrase, phraseIndex) => {
            const helps = attempt.keys?.sort[phraseIndex];
            return <div key={phrase.text} className={`${styles.phrase} ${helps === undefined ? "" : helps ? styles.phraseGood : styles.phraseBad}`}>
              {phrase.text}<span className={styles.comment}><b>{helps === undefined ? "" : helps ? "👍 Помогает: " : "👎 Вредит: "}</b>{phrase.comment}</span>
            </div>;
          })}
        </div>)}
        <div className={styles.read}>{memo}</div>
        <button type="button" className={styles.btn} onClick={() => setView("done")}>← К результату</button>
      </div>}

      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  </section>;
}
