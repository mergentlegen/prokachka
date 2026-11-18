"use client";

import { useEffect, useRef, useState } from "react";
import { finalVoyageAction, type VoyageAttempt } from "@/frontend/shared/api/final-voyage-client";
import { createCompanyVoiceLink } from "@/frontend/shared/api/ready-program-client";
import { ApiError, createTelegramLink } from "@/frontend/shared/api/client";
import { FINAL_VOYAGE_DREAM_LIMIT, FINAL_VOYAGE_DREAM_STEP, FINAL_VOYAGE_PORTS, FINAL_VOYAGE_REWARD, FINAL_VOYAGE_STEPS, type FinalVoyageDream } from "@/shared/domain/final-voyage";
import type { Submission } from "@/shared/domain/types";
import { MaterialBar, MaterialButton } from "./GameMaterial";
import styles from "./FinalVoyageGame.module.css";

// «Финальный рейс уровня 1» (program game `final-voyage-1`), in the colours of the author's file: a route of 6 ports,
// 11 questions and the dream form. The site checks every answer: right — one step forward, wrong — one step back.
// After the finish the mistakes are read again, the site gives the miles, and the participant can send the mentor a voice.
type View = "intro" | "play" | "finish" | "done" | "material";
type Feedback = { step: number; picked: number; right: boolean };
const LETTERS = ["а", "б", "в"];
const TOTAL = FINAL_VOYAGE_STEPS.length;

function viewOf(attempt: VoyageAttempt): View {
  if (attempt.completed) return "done";
  if (attempt.step >= TOTAL) return "finish";
  return attempt.step === 0 && attempt.mistakes === 0 ? "intro" : "play";
}

export function FinalVoyageGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const [attempt, setAttempt] = useState<VoyageAttempt | null>(null);
  const [view, setView] = useState<View>("intro");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [dream, setDream] = useState<FinalVoyageDream>({ what: "", price: "", when: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [linkRequired, setLinkRequired] = useState(false);
  const root = useRef<HTMLElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    finalVoyageAction(taskId, "start").then((saved) => {
      if (!active) return;
      setAttempt(saved); setDream(saved.dream); setView(viewOf(saved)); setError("");
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Не удалось загрузить игру."); });
    return () => { active = false; };
  }, [taskId]);

  const shown = feedback ? feedback.step : attempt?.step ?? 0;
  useEffect(() => { root.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0 }); }, [view, shown]);

  async function send(operation: "answer" | "dream" | "complete", payload: { answer?: number } | FinalVoyageDream = {}) {
    if (!attempt || inFlight.current) return null;
    inFlight.current = true; setBusy(true); setError("");
    try { return await finalVoyageAction(taskId, operation, attempt.step, payload); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ответ не сохранился. Проверьте интернет и нажмите ещё раз."); return null; }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function pick(option: number) {
    if (!attempt || feedback) return;
    const step = attempt.step;
    const saved = await send("answer", { answer: option });
    if (!saved) return;
    setAttempt(saved); setFeedback({ step, picked: option, right: Boolean(saved.right) });
  }

  function next() {
    setFeedback(null);
    if (attempt) { setDream(attempt.dream.what ? attempt.dream : dream); setView(attempt.step >= TOTAL ? "finish" : "play"); }
  }

  async function saveDream() {
    const saved = await send("dream", { what: dream.what.trim(), price: dream.price.trim(), when: dream.when.trim() });
    if (!saved) return;
    setAttempt(saved); setDream(saved.dream); setView(viewOf(saved));
  }

  async function complete() {
    const saved = await send("complete");
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

  const step = FINAL_VOYAGE_STEPS[Math.min(shown, TOTAL - 1)];
  const activePort = view === "intro" ? -1 : view === "play" ? step.port : FINAL_VOYAGE_PORTS.length;
  const mistakes = attempt?.mistakes ?? 0;
  const wrongSteps = Object.keys(attempt?.log || {}).map(Number).sort((a, b) => a - b);
  const dreamReady = [dream.what, dream.price, dream.when].every((value) => value.trim().length > 0);
  const field = (key: keyof FinalVoyageDream, label: string, placeholder: string) => <label className={styles.field}>{label}
    <input value={dream[key]} maxLength={FINAL_VOYAGE_DREAM_LIMIT} placeholder={placeholder} disabled={busy}
      onChange={(event) => { const value = event.target.value; setDream((previous) => ({ ...previous, [key]: value })); }} />
  </label>;

  return <section ref={root} className={styles.voyage} aria-label={"Финальный рейс уровня 1"}>
    <div className={styles.wrap}>
      <header className={styles.top}><h3>🚢 Финальный рейс уровня 1</h3><p>6 портов · проверь себя в жизненных ситуациях</p></header>
      <ol className={styles.route} aria-label="Маршрут">{FINAL_VOYAGE_PORTS.map((port, index) => <li key={port} title={port} aria-label={port}
        className={`${styles.port} ${index < activePort ? styles.portDone : ""} ${index === activePort ? styles.portNow : ""}`}>{index + 1}</li>)}</ol>

      {!attempt && !error && <div className={styles.card}><p className={styles.center}>Загружаем рейс…</p></div>}

      {attempt && view === "intro" && <div className={`${styles.card} ${styles.center}`}>
        <div className={styles.big} aria-hidden="true">⚓</div>
        <p><b>Первый уровень пройден!</b></p>
        <p>Теперь проверь себя в жизненных ситуациях: получится ли применить знания, а не просто вспомнить их.</p>
        <p>За ошибку — шаг назад.<br />Награда за финиш: <b>✈️ {FINAL_VOYAGE_REWARD} миль</b>.</p>
        <button type="button" className={styles.btn} onClick={() => setView("play")}>Поднять якорь 🚢</button>
      </div>}

      {attempt && view === "play" && step.kind === "dream" && <div className={styles.card}>
        <span className={styles.tag}>⚓ Порт {step.port + 1}. {FINAL_VOYAGE_PORTS[step.port]}</span>
        <p className={styles.q}>Заполни свою мечту:</p>
        {field("what", "🎯 Что", "Например: круиз всей семьёй")}
        {field("price", "💰 Сколько стоит", "Например: $6 000")}
        {field("when", "📅 К какому сроку", "Например: лето 2028")}
        <button type="button" className={`${styles.btn} ${styles.blue}`} disabled={!dreamReady || busy} onClick={() => void saveDream()}>{busy ? "Сохраняем…" : "Дальше"}</button>
      </div>}

      {attempt && view === "play" && step.kind === "question" && <div className={styles.card}>
        <span className={styles.tag}>⚓ Порт {step.port + 1}. {FINAL_VOYAGE_PORTS[step.port]}</span>
        <p className={styles.q} id="voyage-question">{step.question}</p>
        <div role="group" aria-labelledby="voyage-question">{step.options.map((option, index) => <button type="button" key={option}
          className={`${styles.opt} ${feedback?.picked === index ? feedback.right ? styles.right : styles.wrong : ""}`}
          disabled={Boolean(feedback) || busy} aria-pressed={feedback?.picked === index} onClick={() => void pick(index)}>
          <b>{LETTERS[index]})</b>{option}
        </button>)}</div>
        {busy && !feedback && <p className={styles.wait} role="status">Проверяем ответ…</p>}
        {feedback && <>
          <div className={`${styles.fb} ${feedback.right ? styles.ok : styles.no}`} role="status">
            {feedback.right ? "✅ " : "❌ "}<b>{feedback.right ? "Верно!" : "Не совсем."}</b> {step.explanation}
          </div>
          <button type="button" className={`${styles.btn} ${feedback.right ? "" : styles.blue}`} onClick={next}>
            {feedback.right ? "Дальше" : feedback.step === 0 ? "Попробовать ещё раз" : "Вернуться на шаг назад"}
          </button>
        </>}
      </div>}

      {attempt && view === "finish" && <div className={`${styles.card} ${styles.center}`}>
        <div className={styles.big} aria-hidden="true">🏁</div>
        <p className={styles.q}>Финиш!</p>
        <div className={styles.stat}>Ошибок за игру: <b>{mistakes}</b></div>
        {wrongSteps.length > 0 && <div className={styles.mistakes}>
          <p className={styles.listTitle}>Где были ошибки</p>
          {wrongSteps.map((index) => { const item = FINAL_VOYAGE_STEPS[index]; return item?.kind === "question" && <div key={index} className={styles.mistake}>
            <b>{item.question}</b><span>{item.explanation}</span>
          </div>; })}
        </div>}
        <p className={styles.q}>По ошибкам всё понятно?</p>
        <button type="button" className={styles.btn} disabled={busy} onClick={() => void complete()}>{busy ? "Начисляем мили…" : "Да, понятно"}</button>
      </div>}

      {attempt && view === "done" && <div className={`${styles.card} ${styles.center}`}>
        <div className={styles.big} aria-hidden="true">🎉</div>
        <div className={styles.miles}>✈️ +{FINAL_VOYAGE_REWARD} миль</div>
        <p className={styles.q}>Уровень 1 пройден!</p>
        <p>Ты знаешь, как работает клуб, как копить, бронировать и что открывается за $95. Следующий шаг — уровень 2.</p>
        <div className={styles.note}>
          <p>🚀 <b>Идём дальше?</b><br />На втором уровне начинается самое интересное — как партнёр начинает зарабатывать и строить свою команду.</p>
          <p>🎙 <b>Ты уже партнёр?</b> Запиши наставнику голосовое:<br /><i>«Я партнёр и хочу на второй уровень»</i></p>
          <button type="button" className={styles.tg} disabled={busy} onClick={() => void voice()}>{busy ? "Открываем Telegram…" : linkRequired ? "Привязать Telegram" : "🎙️ Записать голосовое наставнику"}</button>
          <p className={styles.small}>Голосовое получат наставники твоей ветки. Мили за него не начисляются.</p>
          <p>💡 <b>Ещё не партнёр?</b> Напиши наставнику — он расскажет, как открыть партнёрство за $95 и перейти на второй уровень.</p>
        </div>
        <MaterialButton onClick={() => setView("material")} />
      </div>}

      {attempt && view === "material" && <div className={styles.card}>
        <MaterialBar onBack={() => setView("done")} />
        {attempt.dream.what && <div className={styles.dream}><b>Моя мечта</b><span>🎯 {attempt.dream.what}</span><span>💰 {attempt.dream.price}</span><span>📅 {attempt.dream.when}</span></div>}
        {FINAL_VOYAGE_STEPS.map((item, index) => item.kind === "question" && <div key={index} className={styles.read}>
          <span className={styles.tag}>⚓ Порт {item.port + 1}. {FINAL_VOYAGE_PORTS[item.port]}</span>
          <p className={styles.q}>{item.question}</p>
          {item.options.map((option, optionIndex) => <p key={option} className={`${styles.opt} ${attempt.keys?.[index - (index > FINAL_VOYAGE_DREAM_STEP ? 1 : 0)] === optionIndex ? styles.right : ""}`}>
            <b>{LETTERS[optionIndex]})</b>{option}
          </p>)}
          <p className={styles.explain}>{item.explanation}</p>
        </div>)}
        <button type="button" className={`${styles.btn} ${styles.blue}`} onClick={() => setView("done")}>← К результату</button>
      </div>}

      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {attempt && view === "play" && <p className={styles.counter}>Шаг {shown + 1} из {TOTAL} · ошибок: {mistakes}</p>}
    </div>
  </section>;
}
