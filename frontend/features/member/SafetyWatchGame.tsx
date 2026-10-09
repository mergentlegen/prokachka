"use client";

import { useEffect, useRef, useState } from "react";
import type { Submission } from "@/shared/domain/types";
import { safetyWatchAction } from "@/frontend/shared/api/safety-watch-client";
import { SAFETY_WATCH_DECKS, SAFETY_WATCH_REWARD, SAFETY_WATCH_SOURCES, SAFETY_WATCH_SUMMARY, SAFETY_WATCH_TOTAL } from "@/shared/domain/safety-watch";
import { formatMiles } from "@/frontend/shared/lib/format";
import styles from "./SafetyWatchGame.module.css";

type Screen = "start" | "intro" | "question" | "deckEnd" | "final";
type Turn = { index: number; retry: boolean };

const shuffle = <T,>(items: readonly T[]) => {
  const list = items.slice();
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
};

export function SafetyWatchGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [screen, setScreen] = useState<Screen>("start");
  // Decks the site has accepted; in practice mode (after the miles) nothing is sent.
  const [saved, setSaved] = useState(0);
  const [rewarded, setRewarded] = useState(false);
  const [practice, setPractice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deck, setDeck] = useState(0);
  const [queue, setQueue] = useState<Turn[]>([]);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [order, setOrder] = useState<number[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [solved, setSolved] = useState(0);
  const [fixes, setFixes] = useState(0);
  const [seen, setSeen] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    safetyWatchAction(taskId, "start").then((attempt) => {
      if (!active) return;
      setSaved(attempt.decks); setFixes(attempt.fixes); setSeen(attempt.seen);
      if (attempt.completed) { setRewarded(true); setScreen("final"); }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Не удалось открыть игру."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [taskId]);

  // A new screen or situation starts from its top, like turning a page; an answer never moves the page.
  useEffect(() => {
    const box = top.current;
    if (box && box.getBoundingClientRect().top < 0) box.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [screen, turn]);
  useEffect(() => {
    if (picked !== null) next.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [picked]);

  const current = SAFETY_WATCH_DECKS[deck];
  const doneDecks = practice ? 0 : saved;

  function startDeck(index: number) {
    setDeck(index); setQueue(shuffle(SAFETY_WATCH_DECKS[index].qs.map((_, i) => ({ index: i, retry: false })))); setSolved(0); setError("");
    setScreen("intro");
  }
  function showTurn(list: Turn[]) {
    const [first, ...rest] = list;
    if (!first) { void finishDeck(); return; }
    const question = current.qs[first.index];
    setQueue(rest); setTurn(first); setPicked(null); setLeft(list.length); setSeen((value) => value + 1);
    setOrder(current.type === "two" ? [0, 1] : shuffle((question.opts || []).map((_, i) => i)));
    setScreen("question");
  }
  function answer(choice: number) {
    if (!turn || picked !== null) return;
    const question = current.qs[turn.index];
    setPicked(choice);
    if (choice === question.a) { setSolved((value) => value + 1); if (turn.retry) setFixes((value) => value + 1); }
    else setQueue((list) => [...list, { index: turn.index, retry: true }]);
  }
  async function finishDeck() {
    const last = deck === SAFETY_WATCH_DECKS.length - 1;
    setScreen(last ? "final" : "deckEnd");
    if (practice || rewarded) return;
    setBusy(true); setError("");
    try {
      // Every situation of the deck is now answered right; the site checks the same answers.
      const attempt = await safetyWatchAction(taskId, "save", deck + 1, { answers: current.qs.map((question) => question.a), fixes, seen });
      setSaved(attempt.decks);
      if (last) {
        const done = await safetyWatchAction(taskId, "complete");
        setRewarded(true);
        if (done.submission) onCompleted?.(done.submission);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Прогресс не сохранился. Проверьте интернет."); }
    finally { setBusy(false); }
  }
  function again() {
    setPractice(true); setFixes(0); setSeen(0); setError(""); setScreen("start");
  }

  if (loading) return <div className={styles.game}><p className={styles.loading}>Загружаем игру…</p></div>;
  const question = turn ? current.qs[turn.index] : null;
  const total = current?.qs.length || 1;
  // The deck (or, after the last deck, the miles) did not reach the site: offer to send it again.
  const savingFailed = Boolean(error) && !practice && !rewarded && (saved <= deck || screen === "final");

  return <div className={styles.game} ref={top}>
    {error && <p className={styles.error} role="alert">{error}</p>}

    {screen === "start" && <section className={styles.screen}>
      <div className={styles.hero}>
        <div className={styles.cap}><Captain /></div>
        <div className={styles.kicker}>Игра-закрепление</div>
        <h3>Вахта<br />безопасности</h3>
        <p>Ты — офицер безопасности лайнера. Проверь пассажиров, журнал входов и платежи.</p>
      </div>
      <div className={styles.decks}>{SAFETY_WATCH_DECKS.map((item, index) => {
        const done = index < doneDecks;
        return <div key={item.key} className={`${styles.deck} ${done ? styles.deckDone : ""}`}>
          <div className={styles.icon}>{done ? "✅" : item.emoji}</div>
          <div><b>{item.kicker}. {item.title}</b><span>{item.qs.length} ситуаций</span></div>
        </div>;
      })}</div>
      <div className={styles.rule}>🔁 Ошибся — не страшно. Вопрос вернётся в конце палубы, пока не ответишь правильно. Так правила запоминаются.</div>
      {practice && <div className={styles.rule}>Это повторное прохождение: мили уже начислены.</div>}
      <button type="button" className={`${styles.btn} ${styles.orange}`} onClick={() => startDeck(practice ? 0 : Math.min(saved, SAFETY_WATCH_DECKS.length - 1))}>
        {!practice && saved > 0 ? "Продолжить вахту ⚓" : "Заступить на вахту ⚓"}
      </button>
    </section>}

    {screen === "intro" && current && <section className={styles.screen}>
      <div className={styles.big}>
        <div className={styles.emoji}>{current.emoji}</div>
        <div className={styles.kicker}>{current.kicker}</div>
        <h3>{current.title}</h3>
        <p>{current.intro}</p>
      </div>
      <button type="button" className={`${styles.btn} ${styles.orange}`} onClick={() => showTurn(queue)}>Начать</button>
    </section>}

    {screen === "question" && question && turn && <section className={styles.screen}>
      <div className={styles.top}>
        <div className={styles.deckName}>{current.emoji} {current.kicker}: {current.title}</div>
        <div className={styles.pill}>Осталось {left}</div>
        <div className={`${styles.pill} ${styles.pillScore}`}>✓ {solved}/{total}</div>
      </div>
      <div className={styles.bar}><i style={{ width: `${(solved / total) * 100}%` }} /></div>
      <div className={styles.card}>
        {turn.retry && <div className={styles.retry}>🔁 Ещё раз</div>}
        {question.log && <div className={styles.log}>
          <div className={styles.logHead}><span>ЖУРНАЛ ВХОДОВ</span><span>●REC</span></div>
          <div className={styles.logRow}><span>Аккаунт:</span><b>{question.log.acc}</b></div>
          <div className={styles.logRow}><span>Устройство:</span><b>{question.log.dev}</b></div>
          <div className={styles.logRow}><span>Детали:</span><b>{question.log.ctx}</b></div>
        </div>}
        <div className={styles.question}>{question.q}</div>
        <div className={`${styles.options} ${current.type === "two" ? styles.two : ""}`}>
          {order.map((option, position) => {
            const label = current.type === "two" ? current.labels?.[option] : question.opts?.[option];
            const state = picked === null ? "" : option === question.a ? styles.right : option === picked ? styles.wrong : styles.dim;
            return <button type="button" key={option} className={`${styles.option} ${state}`} disabled={picked !== null} onClick={() => answer(option)}>
              {current.type === "choice" && <span className={styles.letter}>{"АБВ"[position]}</span>}<span>{label}</span>
            </button>;
          })}
        </div>
      </div>
      {picked !== null && <div className={`${styles.feedback} ${picked === question.a ? styles.ok : styles.no}`} role="status">
        <h4>{picked === question.a ? "✅ Верно!" : "❌ Не совсем"}</h4>
        <p>{question.why}</p>
        <div className={styles.source}>📄 {SAFETY_WATCH_SOURCES[question.src]}</div>
        {picked !== question.a && <div className={styles.again}>🔁 Этот вопрос вернётся в конце палубы</div>}
      </div>}
      {picked !== null && <button type="button" ref={next} className={`${styles.btn} ${styles.navy}`} onClick={() => showTurn(queue)}>Дальше →</button>}
    </section>}

    {screen === "deckEnd" && current && <section className={styles.screen}>
      <div className={styles.big}>
        <div className={styles.emoji}>🏅</div>
        <h3>{current.kicker} пройдена!</h3>
        <p>«{current.title}» — все {current.qs.length} ситуаций разобраны.</p>
      </div>
      <div className={styles.memo}><h4>Запомни с этой палубы</h4><ul>{current.memo.map((line) => <li key={line}>{line}</li>)}</ul></div>
      {savingFailed
        ? <button type="button" className={`${styles.btn} ${styles.navy}`} disabled={busy} onClick={() => void finishDeck()}>{busy ? "Сохраняем…" : "Сохранить ещё раз"}</button>
        : <button type="button" className={`${styles.btn} ${styles.orange}`} disabled={busy} onClick={() => startDeck(deck + 1)}>{busy ? "Сохраняем…" : "Следующая палуба →"}</button>}
    </section>}

    {screen === "final" && <section className={styles.screen}>
      <div className={styles.big}>
        <div className={styles.emoji}>⚓</div>
        <h3>Вахта сдана!</h3>
        <p>Ты прошёл все 4 палубы и знаешь, как защитить свой аккаунт, свои баллы и свои выплаты.</p>
        <div className={styles.badge}>🛡️ Офицер безопасности</div>
        <div className={styles.reward} role="status">
          {practice ? "✈️ Мили за эту игру уже начислены" : busy ? "Начисляем мили…" : rewarded ? `+${formatMiles(SAFETY_WATCH_REWARD)} ✈️ начислены` : `+${formatMiles(SAFETY_WATCH_REWARD)} ✈️`}
        </div>
        {rewarded && !practice && <p className={styles.next}>Следующий шаг программы уже открыт.</p>}
      </div>
      {savingFailed && <button type="button" className={`${styles.btn} ${styles.navy}`} disabled={busy} onClick={() => void finishDeck()}>{busy ? "Сохраняем…" : "Сохранить и получить мили"}</button>}
      <div className={styles.stats}>
        <div><b>{seen || SAFETY_WATCH_TOTAL}</b><span>ситуаций разобрано</span></div>
        <div><b>{fixes}</b><span>ошибок исправлено</span></div>
      </div>
      <div className={styles.memo}><h4>Главное за 30 секунд</h4><ul>{SAFETY_WATCH_SUMMARY.map((line) => <li key={line}>{line}</li>)}</ul></div>
      <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={busy} onClick={again}>↻ Пройти ещё раз</button>
      <div className={styles.tip}>Совет: вернись к игре через 2–3 дня. Вопросы перемешаются — проверь, что всё помнишь.</div>
    </section>}
  </div>;
}

/** The captain from the original game. */
function Captain() {
  return <svg viewBox="0 0 100 200" aria-hidden="true"><rect x="36" y="126" width="12" height="66" rx="5" fill="#0f1a2e" /><rect x="52" y="126" width="12" height="66" rx="5" fill="#0f1a2e" /><ellipse cx="43" cy="192" rx="8" ry="4" fill="#1f2937" /><ellipse cx="57" cy="192" rx="8" ry="4" fill="#1f2937" />
    <path d="M36 80 Q24 102 27 126" stroke="#fff" strokeWidth="10" strokeLinecap="round" fill="none" /><circle cx="27" cy="128" r="5" fill="#f3c9a5" /><path d="M64 80 Q76 102 73 126" stroke="#fff" strokeWidth="10" strokeLinecap="round" fill="none" /><circle cx="73" cy="128" r="5" fill="#f3c9a5" />
    <path d="M33 74 Q50 69 67 74 L70 132 H30 Z" fill="#fff" stroke="#c9d3e3" /><rect x="45" y="66" width="10" height="10" fill="#f3c9a5" /><circle cx="50" cy="54" r="19" fill="#f3c9a5" /><path d="M31 50 Q31 32 50 32 Q69 32 69 50 Q63 40 50 40 Q37 40 31 50Z" fill="#6b7280" />
    <circle cx="43" cy="55" r="2.3" fill="#1f2937" /><circle cx="57" cy="55" r="2.3" fill="#1f2937" /><path d="M44 63 Q50 68 56 63" stroke="#7c2d12" strokeWidth="2" fill="none" strokeLinecap="round" />
    <path d="M34 58 Q35 80 50 82 Q65 80 66 58 Q60 71 50 71 Q40 71 34 58Z" fill="#9aa3b5" /><path d="M29 42 Q50 20 71 42 Z" fill="#fff" stroke="#c9d3e3" /><rect x="28" y="39" width="44" height="6" rx="2" fill="#0f1a2e" /><circle cx="50" cy="33" r="3.2" fill="#f7b500" />
    <rect x="31" y="74" width="10" height="4" rx="1.5" fill="#f7b500" /><rect x="59" y="74" width="10" height="4" rx="1.5" fill="#f7b500" /></svg>;
}
