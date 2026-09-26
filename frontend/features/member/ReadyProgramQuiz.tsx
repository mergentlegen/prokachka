"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { answerReadyProgram, completeReadyProgram, restartReadyProgramQuiz, type ReadyAttempt } from "@/frontend/shared/api/ready-program-client";
import { formatMiles } from "@/frontend/shared/lib/format";
import type { Submission } from "@/shared/domain/types";
import styles from "./DreamPlanGame.module.css";

export type ReadyQuizQuestion = { title: string; description?: string; options: readonly string[]; feedback: string };
type Props = {
  taskId: string; initialAttempt: ReadyAttempt; questions: readonly ReadyQuizQuestion[];
  onBack: () => void; onCompleted?: (submission: Submission) => void;
};

function shuffledIndices(length: number) {
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [indices[index], indices[other]] = [indices[other], indices[index]];
  }
  return indices;
}

export function ReadyProgramQuiz({ taskId, initialAttempt, questions, onBack, onCompleted }: Props) {
  const [view, setView] = useState(() => ({
    attempt: initialAttempt,
    questionIndex: Math.min(questions.length - 1, initialAttempt.questionIndex),
    selected: initialAttempt.failed || initialAttempt.ready ? initialAttempt.lastAnswer ?? null : null,
    feedback: initialAttempt.failed ? "incorrect" : initialAttempt.ready ? "correct" : "",
    next: null as number | null,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedbackId = useId();
  const question = questions[view.questionIndex];
  const { attempt } = view;
  const order = useMemo(() => shuffledIndices(question.options.length), [question]);

  useEffect(() => {
    heading.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, [view.questionIndex, attempt.attemptNumber, attempt.completed]);

  async function answer(index: number) {
    if (inFlight.current || view.feedback || attempt.completed) return;
    inFlight.current = true; setBusy(true); setError(""); setView((current) => ({ ...current, selected: index }));
    try {
      const result = await answerReadyProgram(taskId, index, view.questionIndex);
      setView((current) => ({ ...current, attempt: result, selected: index, feedback: result.failed ? "incorrect" : "correct", next: result.failed || result.ready ? null : result.questionIndex }));
    } catch (cause) {
      setView((current) => ({ ...current, selected: null }));
      setError(cause instanceof Error ? cause.message : "Не удалось проверить ответ. Попробуй ещё раз.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function retry() {
    if (inFlight.current || !attempt.failed) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await restartReadyProgramQuiz(taskId);
      setView({ attempt: result, questionIndex: 0, selected: null, feedback: "", next: null });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось начать тест заново."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function finish() {
    if (inFlight.current || !attempt.ready || attempt.completed) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await completeReadyProgram(taskId);
      if (!result.completed || !result.submission) throw new Error("Не удалось подтвердить начисление миль. Попробуй ещё раз.");
      setView((current) => ({ ...current, attempt: result }));
      onCompleted?.(result.submission);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось завершить игру."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className={styles.quiz}>
    <div className={styles.stageLine}><button type="button" className={styles.back} disabled={busy} onClick={onBack}>← К правилам</button><span className={styles.reward}>Награда · {formatMiles(attempt.maxPoints)}</span></div>
    {attempt.completed ? <div className={styles.completed} role="status">
      <span className={styles.resultIcon} aria-hidden="true">✓</span><p className={styles.kicker}>Отличный старт</p>
      <h4 ref={heading} tabIndex={-1}>Правила усвоены!</h4>
      <strong className={styles.resultMiles}>+{formatMiles(attempt.earnedPoints)}</strong>
      <p>Все ответы верные. Мили уже добавлены в твой рейтинг.</p>
      <span className={styles.resultHint}>Закрой окно и переходи к следующим заданиям.</span>
    </div> : <>
      <div className={styles.quizProgress}>
        <div className={styles.progressHead}><b>Вопрос {view.questionIndex + 1} из {questions.length}</b><span>{attempt.earnedPoints} / {formatMiles(attempt.maxPoints)}</span></div>
        <div className={styles.quizSteps} aria-label={`Верных ответов: ${attempt.earnedPoints} из ${questions.length}`}>{questions.map((item, index) => <span key={item.title} className={index < attempt.earnedPoints ? styles.stepDone : index === view.questionIndex ? attempt.failed ? styles.stepFailed : styles.stepCurrent : ""} />)}</div>
      </div>
      <div className={styles.question}>
        <p className={styles.kicker}>Проверь себя</p><h4 ref={heading} id={`${feedbackId}-question`} tabIndex={-1}>{question.title}</h4>
        {question.description && <p className={styles.questionDescription}>{question.description}</p>}
        <div className={styles.options} role="group" aria-labelledby={`${feedbackId}-question`}>{order.map((index, position) => {
          const selected = view.selected === index;
          const resultClass = selected ? view.feedback === "incorrect" ? styles.incorrect : view.feedback === "correct" ? styles.correct : styles.checking : "";
          return <button type="button" key={index} className={`${styles.option} ${resultClass}`} disabled={busy || Boolean(view.feedback)} onClick={() => void answer(index)} aria-pressed={selected} aria-describedby={selected && view.feedback ? feedbackId : undefined}>
            <span className={styles.optionLetter} aria-hidden="true">{["А", "Б", "В"][position]}</span><span>{question.options[index]}</span><span className={styles.optionMark} aria-hidden="true">{selected && view.feedback === "incorrect" ? "×" : selected && view.feedback === "correct" ? "✓" : ""}</span>
          </button>;
        })}</div>
        {busy && !view.feedback && <p className={styles.checkingText} role="status">Проверяем ответ…</p>}
        {view.feedback === "correct" && <div id={feedbackId} className={styles.quizSuccess} role="status"><strong>Верно! +1 миля</strong><p>{question.feedback}</p></div>}
        {view.feedback === "incorrect" && <div id={feedbackId} className={styles.quizFailure} role="alert"><strong>Этот ответ неверный</strong><p>{question.feedback}</p><p>Нажми «Пройти заново», чтобы повторить тест и собрать все {formatMiles(attempt.maxPoints)}.</p><button type="button" className={styles.retry} disabled={busy} onClick={() => void retry()}>{busy ? "Подготавливаем тест…" : "Пройти заново"}</button></div>}
        {error && <div className={styles.quizFailure} role="alert"><strong>Не удалось сохранить результат</strong><p>{error}</p></div>}
        {view.next !== null && <button type="button" className={styles.primary} onClick={() => { setView((current) => ({ ...current, questionIndex: current.next!, selected: null, feedback: "", next: null })); setError(""); }}>Следующий вопрос →</button>}
        {attempt.ready && <div className={styles.finishAction}><p>Все ответы верные. Подтверди завершение, чтобы получить награду.</p><button type="button" className={styles.primary} disabled={busy} onClick={() => void finish()}>{busy ? "Начисляем мили…" : `Завершить и получить ${formatMiles(attempt.maxPoints)}`}</button></div>}
        {!view.feedback && <p className={styles.quizHint}>За каждый верный ответ — 1 миля. Награда начисляется после завершения всего теста.</p>}
      </div>
    </>}
  </div>;
}
