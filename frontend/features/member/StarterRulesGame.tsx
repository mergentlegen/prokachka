"use client";

import { useEffect, useRef, useState } from "react";
import { participationRulesAction, type RulesAttempt } from "@/frontend/shared/api/participation-rules-client";
import { formatMiles } from "@/frontend/shared/lib/format";
import { PARTICIPATION_RULES, PARTICIPATION_RULES_QUESTIONS } from "@/shared/domain/participation-rules";
import type { Submission } from "@/shared/domain/types";
import { MaterialButton } from "./GameMaterial";
import styles from "./StarterRulesGame.module.css";

// «Правила участия» (kind `starter-rules`): the ten rules and five questions on one page, as in the author's file.
// One try per question; the site keeps the first answer, says which option was right and gives 1 mile for each right
// one when the fifth question is answered. A finished page stays readable: it is the game's material.
function shuffled(length: number) {
  const order = Array.from({ length }, (_, index) => index);
  for (let index = length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  return order;
}

export function StarterRulesGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const [attempt, setAttempt] = useState<RulesAttempt | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState<number | null>(null);
  const [orders] = useState(() => PARTICIPATION_RULES_QUESTIONS.map((question) => shuffled(question.options.length)));
  const root = useRef<HTMLElement>(null);
  const done = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    participationRulesAction(taskId, "start").then((saved) => { if (active) { setError(""); setAttempt(saved); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Не удалось загрузить правила."); });
    return () => { active = false; };
  }, [taskId]);

  useEffect(() => { root.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0 }); }, []);

  async function answer(question: number, option: number) {
    if (!attempt || inFlight.current || attempt.answers[question] !== undefined || attempt.completed) return;
    inFlight.current = true; setSending(question); setError("");
    try {
      const saved = await participationRulesAction(taskId, "answer", question, option);
      setAttempt(saved);
      if (saved.completed && !attempt.completed) {
        if (saved.submission) onCompleted?.(saved.submission);
        window.setTimeout(() => done.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ответ не сохранился. Проверьте интернет и нажмите ещё раз."); }
    finally { inFlight.current = false; setSending(null); }
  }

  const total = PARTICIPATION_RULES_QUESTIONS.length;
  const earned = attempt?.earnedPoints ?? 0;
  return <section ref={root} className={styles.rules} aria-label="Правила участия">
    <header className={styles.header}>
      <span className={styles.badge}>🚢 Прокачка</span>
      <h3>Правила участия в «Прокачке»</h3>
      <p>Коротко и по делу: как проходить платформу.</p>
    </header>
    <div className={styles.wrap}>
      {PARTICIPATION_RULES.map((rule, index) => <article key={rule.title} className={`${styles.card} ${styles.rule}`}>
        <div className={styles.num} aria-hidden="true">{index + 1}</div>
        <div><h4>{rule.title}</h4><p>{rule.text}</p></div>
      </article>)}

      <h4 className={styles.sectionTitle}>Проверь себя</h4>
      <p className={styles.muted}>5 вопросов по правилам. За каждый верный ответ с первой попытки — 1 миля.</p>
      <div className={styles.score} role="status"><span>Твои мили</span><span>✈️ {earned} / {total}</span></div>

      {!attempt && !error && <p className={styles.muted}>Загружаем твои ответы…</p>}
      {attempt && PARTICIPATION_RULES_QUESTIONS.map((question, index) => {
        const picked = attempt.answers[index];
        const right = attempt.rights[index];
        const closed = picked !== undefined || attempt.completed;
        return <div key={question.title} className={`${styles.card} ${styles.question}`}>
          <p className={styles.title} id={`rules-q${index}`}>{question.title}</p>
          <div role="group" aria-labelledby={`rules-q${index}`}>{orders[index].map((option) => <button type="button" key={option}
            className={`${styles.opt} ${right === option ? styles.ok : ""} ${picked === option && right !== option ? styles.no : ""}`}
            disabled={closed || sending !== null} aria-pressed={picked === option} onClick={() => void answer(index, option)}>
            {question.options[option]}
          </button>)}</div>
          {sending === index && <p className={styles.fb} role="status">Проверяем ответ…</p>}
          {picked !== undefined && right !== undefined && <p className={styles.fb} role="status">
            {picked === right ? `Верно! +1 миля. ${question.explanation}` : `Не совсем. ${question.explanation}`}
          </p>}
        </div>;
      })}
      {error && <p className={styles.error} role="alert">{error}</p>}

      {attempt?.completed && <div ref={done} className={styles.done}>
        <div className={styles.plane} aria-hidden="true">✈️</div>
        <b>+{formatMiles(earned)}!</b>
        <p>{Object.keys(attempt.answers).length ? "Мили начислены автоматически — они уже в твоём рейтинге." : "Правила уже пройдены, мили начислены."}</p>
        <MaterialButton label="Перечитать правила" onClick={() => root.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "smooth" })} />
      </div>}
    </div>
  </section>;
}
