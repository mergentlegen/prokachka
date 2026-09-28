"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Submission } from "@/shared/domain/types";
import { ORG_BLITZ, ORG_BUCKETS, ORG_QUIZ, ORG_SORT } from "@/shared/domain/org-environment";
import { advanceOrgQuestion, answerOrgQuestion, beginOrgRound, createOrgSession, validOrgSession, type OrgSession } from "@/shared/domain/org-environment-engine";
import { orgGameStart, orgGameSubmit, type OrgResult } from "@/frontend/shared/api/org-environment-client";
import styles from "./OrgEnvironmentGame.module.css";

const QUIZ_SECONDS = 20;
const BLITZ_SECONDS = 45;
const storageKey = (attemptId: string) => `prokachka:org-environment:${attemptId}`;

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
  const [session, setSession] = useState<OrgSession | null>(null);
  const [result, setResult] = useState<OrgResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const lock = useRef(false);

  const load = useCallback(async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const saved = await orgGameStart(taskId);
      if (saved.completed) {
        setSession(null); setResult(saved);
        try { window.localStorage.removeItem(storageKey(saved.attemptId)); } catch { /* storage may be disabled */ }
      } else {
        const fresh = createOrgSession(saved.attemptId, saved.quizOrder, saved.sortOrder, saved.blitzOrder);
        let restored: OrgSession | null = null;
        try {
          const value = window.localStorage.getItem(storageKey(saved.attemptId));
          if (value) {
            const parsed: unknown = JSON.parse(value);
            if (validOrgSession(parsed, saved.attemptId, saved.quizOrder, saved.sortOrder, saved.blitzOrder)) restored = parsed;
          }
        } catch { /* continue from the beginning on this device */ }
        setResult(null); setSession(restored || fresh); setTick(Date.now());
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ойын ашылмады. Қайта көріңіз."); }
    finally { lock.current = false; setBusy(false); }
  }, [taskId]);

  useEffect(() => { const id = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(id); }, [load]);
  useEffect(() => {
    if (!session) return;
    try { window.localStorage.setItem(storageKey(session.attemptId), JSON.stringify(session)); } catch { /* private browsing */ }
  }, [session]);
  useEffect(() => {
    if (session?.phase !== "quiz" && session?.phase !== "blitz") return;
    const id = window.setInterval(() => setTick(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [session?.phase]);

  const begin = useCallback(() => { const now = Date.now(); setTick(now); setSession((previous) => previous ? beginOrgRound(previous, now) : previous); }, []);
  const answer = useCallback((choice: number | null) => setSession((previous) => previous ? answerOrgQuestion(previous, choice, Date.now()) : previous), []);
  const advance = useCallback(() => { const now = Date.now(); setTick(now); setSession((previous) => previous ? advanceOrgQuestion(previous, now) : previous); }, []);
  const clearLast = useCallback(() => setSession((previous) => previous ? { ...previous, last: null } : previous), []);

  const phase = session?.phase;
  const index = session?.index ?? 0;
  const last = session?.last;
  const quizId = session?.quizOrder[index];
  const sortId = session?.sortOrder[index];
  const blitzId = session?.blitzOrder[index];
  const choiceOrder = useMemo(() => quizId === undefined ? [] : shuffledChoices(quizId, index), [quizId, index]);
  const quizLeft = Math.max(0, QUIZ_SECONDS - (tick - (session?.questionStarted || tick)) / 1000);
  const blitzLeft = Math.max(0, BLITZ_SECONDS - (tick - (session?.blitzStarted || tick)) / 1000);

  useEffect(() => {
    if (phase !== "quiz" || last || session?.awaitNext || !session?.questionStarted || quizLeft > 0) return;
    const id = window.setTimeout(() => answer(null), 0);
    return () => window.clearTimeout(id);
  }, [phase, last, session?.awaitNext, session?.questionStarted, quizLeft, answer]);
  useEffect(() => {
    if (last?.phase !== "sort" && last?.phase !== "blitz") return;
    const id = window.setTimeout(() => { if (session?.awaitNext) advance(); else clearLast(); },
      last.phase === "sort" ? last.correct ? 700 : 1500 : last.correct ? 250 : 600);
    return () => window.clearTimeout(id);
  }, [last, session?.awaitNext, advance, clearLast]);

  const finish = useCallback(async () => {
    if (!session || phase !== "blitz" || Date.now() - session.blitzStarted < 45000 || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const saved = await orgGameSubmit(taskId, session.transcript);
      setResult(saved); setSession(null);
      try { window.localStorage.removeItem(storageKey(session.attemptId)); } catch { /* storage may be disabled */ }
      if (saved.submission) onCompleted?.(saved.submission);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Нәтиже сақталмады. Қайта көріңіз."); }
    finally { lock.current = false; setBusy(false); }
  }, [session, phase, taskId, onCompleted]);

  const display = result || session;
  const rank = (display?.score ?? 0) >= 3400 ? "Басқару шебері 🏆" : (display?.score ?? 0) >= 2200 ? "Стратег 🎯" : (display?.score ?? 0) >= 1000 ? "Менеджер 📈" : "Жаңа бастаушы 🌱";
  const round = phase === "quiz" || phase === "intro1" ? 1 : phase === "sort" || phase === "intro2" ? 2 : 3;

  return <section className={styles.game} lang="kk" aria-label="Ұйым ортасы: Миль жарысы">
    {session && phase !== "intro1" && <div className={styles.hud}>
      <div className={styles.pill}><small>Миль</small><b>{session.score}</b></div>
      <div className={styles.pill}><small>Серия</small><b>{session.streak}{session.streak >= 5 ? " ×2" : session.streak >= 3 ? " ×1.5" : ""}</b></div>
      <div className={styles.pill}><small>Раунд</small><b>{round}/3</b></div>
    </div>}
    <div className={styles.card}>
      {!display && <div className={styles.center}><h2>Ұйым ортасы: Миль жарысы</h2><p>Ойын жүктелуде…</p><button type="button" className={styles.button} disabled={busy} onClick={() => void load()}>Қайта көру</button></div>}
      {result?.completed && <div className={styles.center}>
        <p className={styles.muted}>Жарыс аяқталды · нәтиже сақталды</p>
        <div className={styles.big}>{result.score}</div><p>миль жиналды</p>
        <span className={styles.rank}>{rank}</span>
        <div className={styles.stats}>
          <div><b>{result.answered ? Math.round(result.correct / result.answered * 100) : 0}%</b><small>Дәлдік</small></div>
          <div><b>{result.correct}/{result.answered}</b><small>Дұрыс жауап</small></div>
          <div><b>{result.best}</b><small>Ең ұзын серия</small></div>
        </div>
        <div className={styles.rows}>{["Квиз", "Сұрыптау", "Блиц"].map((name, i) => <div key={name}><span>{i+1}-раунд · {name}</span><b>{result.rounds[i] ?? 0}</b></div>)}</div>
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
        <p className={styles.muted}>Қате жауап үшін кері қайтпайсың. Соңында «Нәтижені сақтау» түймесі арқылы жинаған милің бір рет тіркеледі.</p>
        <button type="button" className={styles.button} onClick={begin}>Бастау</button>
      </>}
      {!last && (phase === "intro2" || phase === "intro3") && <div className={styles.center}>
        <p className={styles.muted}>{phase === "intro2" ? "2" : "3"}-раунд</p>
        <h2>{phase === "intro2" ? "Сұрыптау" : "Блиц"}</h2>
        <p className={styles.muted}>{phase === "intro2" ? "Әр факторды өз ортасына орналастыр." : "Уақыт азайғанша мүмкіндігінше көп жауап бер!"}</p>
        <button type="button" className={styles.button} onClick={begin}>Дайынмын</button>
      </div>}
      {last?.phase === "quiz" && <>
        <p className={styles.meta}>Сұрақ {last.index + 1} / 10</p>
        <h2>{ORG_QUIZ[last.itemId]?.q}</h2>
        <div className={last.correct ? styles.ok : styles.bad}><b>{last.correct ? `Дұрыс! +${last.delta}` : last.timedOut ? "Уақыт бітті." : "Қате."}</b> {ORG_QUIZ[last.itemId]?.exp}</div>
        <button type="button" className={styles.button} onClick={() => { if (session?.awaitNext) advance(); else clearLast(); }}>Келесі →</button>
      </>}
      {!last && phase === "quiz" && !session?.awaitNext && quizId !== undefined && <>
        <div className={styles.meta}><span>Сұрақ {index + 1} / 10</span><span>{Math.ceil(quizLeft)} с</span></div>
        <div className={styles.timer}><i style={{ width: `${quizLeft / QUIZ_SECONDS * 100}%` }} /></div>
        <h2 className={styles.question}>{ORG_QUIZ[quizId]?.q}</h2>
        <div className={styles.options}>{choiceOrder.map((choice, number) => <button type="button" key={choice} disabled={quizLeft <= 0} onClick={() => answer(choice)}><span>{number + 1}</span>{choice === 0 ? ORG_QUIZ[quizId]?.a : ORG_QUIZ[quizId]?.w[choice - 1]}</button>)}</div>
      </>}
      {last?.phase === "sort" && <div className={last.correct ? styles.ok : styles.bad}><b>{last.correct ? `Дұрыс! +${last.delta}` : "Қате."}</b> {ORG_SORT[last.itemId]?.[0]} — {ORG_BUCKETS[last.expected]?.name}.</div>}
      {!last && phase === "sort" && !session?.awaitNext && sortId !== undefined && <>
        <div className={styles.meta}><span>Фактор {index + 1} / 15</span><span>Қай ортаға жатады?</span></div>
        <div className={styles.item}>{ORG_SORT[sortId]?.[0]}</div>
        <div className={styles.buckets}>{ORG_BUCKETS.map((bucket, choice) => <button type="button" key={bucket.name} onClick={() => answer(choice)}><b>{choice + 1}. {bucket.name}</b><small>{bucket.hint}</small></button>)}</div>
      </>}
      {phase === "blitz" && <>
        <div className={styles.meta}><span>Жауап: {index}</span><span>{Math.ceil(blitzLeft)} с</span></div>
        <div className={styles.timer}><i style={{ width: `${blitzLeft / BLITZ_SECONDS * 100}%` }} /></div>
        <div className={`${styles.statement} ${last?.phase === "blitz" ? last.correct ? styles.ok : styles.bad : ""}`}>{last?.phase === "blitz" ? ORG_BLITZ[last.itemId]?.[0] : blitzId !== undefined ? ORG_BLITZ[blitzId]?.[0] : ""}</div>
        <div className={styles.trueFalse}><button type="button" disabled={session?.awaitNext || Boolean(last) || blitzLeft <= 0 || blitzId === undefined} onClick={() => answer(1)}>✓ Дұрыс</button><button type="button" disabled={session?.awaitNext || Boolean(last) || blitzLeft <= 0 || blitzId === undefined} onClick={() => answer(0)}>✗ Қате</button></div>
        {last?.phase === "blitz" && <p className={styles.center}>{last.correct ? `Дұрыс! +${last.delta}` : "Қате."}</p>}
        {blitzLeft <= 0 && <button type="button" className={styles.button} disabled={busy} onClick={() => void finish()}>{busy ? "Сақталуда…" : "Нәтижені сақтау"}</button>}
      </>}
      {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => { setError(""); if (!session) void load(); }}>Қайта көру</button></div>}
    </div>
  </section>;
}
