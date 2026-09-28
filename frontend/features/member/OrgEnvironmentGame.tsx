"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Submission } from "@/shared/domain/types";
import { ORG_BLITZ, ORG_BUCKETS, ORG_QUIZ, ORG_SORT } from "@/shared/domain/org-environment";
import { orgGameAction, type OrgAttempt, type OrgPhase } from "@/frontend/shared/api/org-environment-client";
import styles from "./OrgEnvironmentGame.module.css";

type Feedback = { phase: OrgPhase; index: number; itemId: number; correct: boolean; expected: number; delta: number; timedOut: boolean };
const QUIZ_SECONDS = 20;
const BLITZ_SECONDS = 45;

function shuffledChoices(itemId: number, index: number) {
  const order = [0, 1, 2, 3];
  let seed = (itemId + 1) * 193 + index * 887;
  for (let i = 3; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function OrgEnvironmentGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const [attempt, setAttempt] = useState<OrgAttempt | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const lock = useRef(false);

  const accept = useCallback((next: OrgAttempt) => {
    setClockOffset(Date.parse(next.serverNow) - Date.now());
    setAttempt(next);
    setTick(Date.now());
  }, []);

  const load = useCallback(async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const saved = await orgGameAction(taskId, "start");
      accept(saved);
      if (saved.awaitNext && saved.last) {
        const itemId = saved.last.phase === "quiz" ? saved.quizOrder[saved.last.index]
          : saved.last.phase === "sort" ? saved.sortOrder[saved.last.index]
          : saved.blitzOrder[saved.last.index % ORG_BLITZ.length];
        if (itemId !== undefined) setFeedback({ phase: saved.last.phase, index: saved.last.index, itemId, correct: Boolean(saved.last.correct),
          expected: saved.last.expected, delta: saved.last.delta, timedOut: saved.last.timedOut });
      }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ойын ашылмады. Қайта көріңіз."); }
    finally { lock.current = false; setBusy(false); }
  }, [accept, taskId]);

  useEffect(() => { const id = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(id); }, [load]);
  useEffect(() => {
    if (!attempt || attempt.completed || (attempt.phase !== "quiz" && attempt.phase !== "blitz")) return;
    const id = window.setInterval(() => setTick(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [attempt]);

  const run = useCallback(async (operation: "begin" | "answer" | "advance" | "finish", index?: number, answer?: number | null, itemId?: number) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const next = await orgGameAction(taskId, operation, index, answer);
      accept(next);
      if (operation === "advance") setFeedback(null);
      if (operation === "answer" && next.last && next.last.index === index && itemId !== undefined) {
        setFeedback({ phase: next.last.phase, index: next.last.index, itemId, correct: Boolean(next.last.correct), expected: next.last.expected,
          delta: next.last.delta, timedOut: next.last.timedOut });
      }
      if (next.completed && next.submission) onCompleted?.(next.submission);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Жауап сақталмады. Қайта көріңіз."); }
    finally { lock.current = false; setBusy(false); }
  }, [accept, onCompleted, taskId]);

  const phase = attempt?.phase;
  const index = attempt?.index ?? 0;
  const quizId = attempt?.quizOrder[index];
  const sortId = attempt?.sortOrder[index];
  const blitzId = attempt?.blitzOrder[index % ORG_BLITZ.length];
  const choiceOrder = useMemo(() => quizId === undefined ? [] : shuffledChoices(quizId, index), [quizId, index]);
  const serverTime = tick + clockOffset;
  const quizLeft = Math.max(0, QUIZ_SECONDS - (serverTime - Date.parse(attempt?.questionStarted || "")) / 1000);
  const blitzLeft = Math.max(0, BLITZ_SECONDS - (serverTime - Date.parse(attempt?.blitzStarted || "")) / 1000);

  useEffect(() => {
    if (phase !== "quiz" || quizId === undefined || feedback || busy || attempt?.awaitNext || !attempt?.questionStarted || quizLeft > 0) return;
    const id = window.setTimeout(() => void run("answer", index, null, quizId), 0);
    return () => window.clearTimeout(id);
  }, [phase, quizId, feedback, busy, attempt?.awaitNext, attempt?.questionStarted, quizLeft, index, run]);
  useEffect(() => {
    if (phase !== "blitz" || busy || !attempt?.blitzStarted || blitzLeft > 0) return;
    const id = window.setTimeout(() => void run("finish"), 0);
    return () => window.clearTimeout(id);
  }, [phase, busy, attempt?.blitzStarted, blitzLeft, run]);
  useEffect(() => {
    if (!feedback || feedback.phase !== "sort") return;
    const id = window.setTimeout(() => { if (attempt?.awaitNext) void run("advance"); else setFeedback(null); }, feedback.correct ? 700 : 1500);
    return () => window.clearTimeout(id);
  }, [feedback, attempt?.awaitNext, run]);
  useEffect(() => {
    if (!feedback || feedback.phase !== "blitz") return;
    const id = window.setTimeout(() => { if (attempt?.awaitNext) void run("advance"); else setFeedback(null); }, feedback.correct ? 250 : 600);
    return () => window.clearTimeout(id);
  }, [feedback, attempt?.awaitNext, run]);

  const rank = (attempt?.score ?? 0) >= 3400 ? "Басқару шебері 🏆" : (attempt?.score ?? 0) >= 2200 ? "Стратег 🎯" : (attempt?.score ?? 0) >= 1000 ? "Менеджер 📈" : "Жаңа бастаушы 🌱";
  const round = phase === "quiz" || phase === "intro1" ? 1 : phase === "sort" || phase === "intro2" ? 2 : 3;

  return <section className={styles.game} lang="kk" aria-label="Ұйым ортасы: Миль жарысы">
    {attempt && !attempt.completed && phase !== "intro1" && <div className={styles.hud}>
      <div className={styles.pill}><small>Миль</small><b>{attempt.score}</b></div>
      <div className={styles.pill}><small>Серия</small><b>{attempt.streak}{attempt.streak >= 5 ? " ×2" : attempt.streak >= 3 ? " ×1.5" : ""}</b></div>
      <div className={styles.pill}><small>Раунд</small><b>{round}/3</b></div>
    </div>}
    <div className={styles.card}>
      {!attempt && <div className={styles.center}><h2>Ұйым ортасы: Миль жарысы</h2><p>Ойын жүктелуде…</p><button type="button" className={styles.button} disabled={busy} onClick={() => void load()}>Қайта көру</button></div>}
      {attempt?.completed && <div className={styles.center}>
        <p className={styles.muted}>Жарыс аяқталды · нәтиже сақталды</p>
        <div className={styles.big}>{attempt.score}</div><p>миль жиналды</p>
        <span className={styles.rank}>{rank}</span>
        <div className={styles.stats}>
          <div><b>{attempt.answered ? Math.round(attempt.correct / attempt.answered * 100) : 0}%</b><small>Дәлдік</small></div>
          <div><b>{attempt.correct}/{attempt.answered}</b><small>Дұрыс жауап</small></div>
          <div><b>{attempt.best}</b><small>Ең ұзын серия</small></div>
        </div>
        <div className={styles.rows}>{["Квиз", "Сұрыптау", "Блиц"].map((name, i) => <div key={name}><span>{i+1}-раунд · {name}</span><b>{attempt.rounds[i] ?? 0}</b></div>)}</div>
        <p className={styles.muted}>Нәтиже бір рет тіркелді. Қайта ойнау арқылы оны өзгерту мүмкін емес.</p>
      </div>}
      {phase === "intro1" && <>
        <h2>Ұйым ортасы: <span className={styles.accent}>Миль жарысы</span></h2>
        <p className={styles.muted}>«Ұйымның ішкі және сыртқы орталары» тақырыбы бойынша 3 раундтық жарыс. Жылдам және дұрыс жауап бер — көбірек миль жина!</p>
        <div className={styles.rules}>
          <div><strong>1</strong><span><b>Білім квизі</b><br />10 сұрақ, әрқайсысына 20 сек. 100 миль + жылдамдық бонусы.</span></div>
          <div><strong>2</strong><span><b>Сұрыптау</b><br />Факторды дұрыс ортаға жібер: ішкі, тура әсер немесе жанама әсер.</span></div>
          <div><strong>3</strong><span><b>Блиц</b><br />45 секундта «Дұрыс» немесе «Қате». Комбо бонусы бар.</span></div>
          <div><strong>🔥</strong><span><b>Серия көбейткіші</b><br />Қатарынан 3 дұрыс — ×1.5, 5 дұрыс — ×2 (1–2 раундта).</span></div>
        </div>
        <p className={styles.muted}>Қате жауап үшін кері қайтпайсың. Ойын соңындағы нақты нәтиже бір рет сақталады.</p>
        <button type="button" className={styles.button} disabled={busy} onClick={() => void run("begin")}>Бастау</button>
      </>}
      {!feedback && (phase === "intro2" || phase === "intro3") && <div className={styles.center}>
        <p className={styles.muted}>{phase === "intro2" ? "2" : "3"}-раунд</p>
        <h2>{phase === "intro2" ? "Сұрыптау" : "Блиц"}</h2>
        <p className={styles.muted}>{phase === "intro2" ? "Әр факторды өз ортасына орналастыр." : "Уақыт азайғанша мүмкіндігінше көп жауап бер!"}</p>
        <button type="button" className={styles.button} disabled={busy} onClick={() => void run("begin")}>Дайынмын</button>
      </div>}
      {feedback?.phase === "quiz" && <>
        <p className={styles.meta}>Сұрақ {feedback.index + 1} / 10</p>
        <h2>{ORG_QUIZ[feedback.itemId]?.q}</h2>
        <div className={feedback.correct ? styles.ok : styles.bad}><b>{feedback.correct ? `Дұрыс! +${feedback.delta}` : feedback.timedOut ? "Уақыт бітті." : "Қате."}</b> {ORG_QUIZ[feedback.itemId]?.exp}</div>
        <button type="button" className={styles.button} disabled={busy} onClick={() => { if (attempt?.awaitNext) void run("advance"); else setFeedback(null); }}>Келесі →</button>
      </>}
      {!feedback && phase === "quiz" && !attempt?.awaitNext && quizId !== undefined && <>
        <div className={styles.meta}><span>Сұрақ {index + 1} / 10</span><span>{Math.ceil(quizLeft)} с</span></div>
        <div className={styles.timer}><i style={{ width: `${quizLeft / QUIZ_SECONDS * 100}%` }} /></div>
        <h2 className={styles.question}>{ORG_QUIZ[quizId]?.q}</h2>
        <div className={styles.options}>{choiceOrder.map((choice, number) => <button type="button" key={choice} disabled={busy || quizLeft <= 0} onClick={() => void run("answer", index, choice, quizId)}><span>{number + 1}</span>{choice === 0 ? ORG_QUIZ[quizId]?.a : ORG_QUIZ[quizId]?.w[choice - 1]}</button>)}</div>
      </>}
      {feedback?.phase === "sort" && <div className={feedback.correct ? styles.ok : styles.bad}><b>{feedback.correct ? `Дұрыс! +${feedback.delta}` : "Қате."}</b> {ORG_SORT[feedback.itemId]?.[0]} — {ORG_BUCKETS[feedback.expected]?.name}.</div>}
      {!feedback && phase === "sort" && !attempt?.awaitNext && sortId !== undefined && <>
        <div className={styles.meta}><span>Фактор {index + 1} / 15</span><span>Қай ортаға жатады?</span></div>
        <div className={styles.item}>{ORG_SORT[sortId]?.[0]}</div>
        <div className={styles.buckets}>{ORG_BUCKETS.map((bucket, choice) => <button type="button" key={bucket.name} disabled={busy} onClick={() => void run("answer", index, choice, sortId)}><b>{choice + 1}. {bucket.name}</b><small>{bucket.hint}</small></button>)}</div>
      </>}
      {phase === "blitz" && <>
        <div className={styles.meta}><span>Жауап: {index}</span><span>{Math.ceil(blitzLeft)} с</span></div>
        <div className={styles.timer}><i style={{ width: `${blitzLeft / BLITZ_SECONDS * 100}%` }} /></div>
        <div className={`${styles.statement} ${feedback?.phase === "blitz" ? feedback.correct ? styles.ok : styles.bad : ""}`}>{feedback?.phase === "blitz" ? ORG_BLITZ[feedback.itemId]?.[0] : blitzId !== undefined ? ORG_BLITZ[blitzId]?.[0] : ""}</div>
        <div className={styles.trueFalse}><button type="button" disabled={busy || attempt?.awaitNext || Boolean(feedback) || blitzLeft <= 0} onClick={() => void run("answer", index, 1, blitzId)}>✓ Дұрыс</button><button type="button" disabled={busy || attempt?.awaitNext || Boolean(feedback) || blitzLeft <= 0} onClick={() => void run("answer", index, 0, blitzId)}>✗ Қате</button></div>
        {feedback?.phase === "blitz" && <p className={styles.center}>{feedback.correct ? `Дұрыс! +${feedback.delta}` : "Қате."}</p>}
        {blitzLeft <= 0 && <button type="button" className={styles.button} disabled={busy} onClick={() => void run("finish")}>Нәтижені сақтау</button>}
      </>}
      {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => { setError(""); void load(); }}>Қайта жүктеу</button></div>}
    </div>
  </section>;
}
