"use client";

import { useEffect, useRef, useState } from "react";
import { loadMemberQuiz, saveQuizDraft, submitTaskQuiz, type MemberQuiz } from "@/frontend/shared/api/task-quiz-client";
import { firstUnanswered, type QuizAnswers } from "@/shared/domain/task-quiz";
import { plural } from "@/frontend/shared/lib/plural";
import styles from "./TaskQuiz.module.css";

const DRAFT_DELAY_MS = 1200;

// Questions answered on the site. They open after the task video and are sent to the mentor as a normal answer.
/** Shown after sending, also once the card has refreshed to "на проверке". */
export function QuizSentNotice({ score, total }: { score: number; total: number }) {
  return <div className={styles.sent} role="status">
    <span aria-hidden="true">✓</span>
    <div><strong>Ответы отправлены наставнику</strong><p>{total ? `Тест: ${score} из ${total} верно. ` : ""}Наставник проверит ответы и напишет обратную связь.</p></div>
  </div>;
}

/** A voice task: the test is saved, the voice message is still to be recorded in Telegram before `expiresAt`. */
/** When the 30 minutes pass, `onExpired` brings the test back so the participant can send it again. */
export function VoicePendingNotice({ url, expiresAt, onExpired }: { url: string; expiresAt: string; onExpired?: () => void }) {
  useEffect(() => {
    if (!onExpired) return;
    const timer = window.setTimeout(onExpired, Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt, onExpired]);
  const until = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(expiresAt));
  return <div className={styles.pending} role="status">
    <span aria-hidden="true">🎙</span>
    <div>
      <strong>Осталось записать голосовое</strong>
      <p>Ответы на тест сохранены. Запишите голосовое в Telegram до {until} — без него задание не отправится.</p>
      <a className={styles.telegram} href={url}>Открыть Telegram ещё раз</a>
    </div>
  </div>;
}

export function TaskQuiz({ taskId, videoWatched, voice = false, onSubmitted, onVoicePending }: { taskId: string; videoWatched: boolean;
  /** The answer is the test plus a voice message: sending opens the bot, the test waits for the voice. */ voice?: boolean;
  onSubmitted: (result: { score: number; total: number }) => void; onVoicePending?: (link: { url: string; expiresAt: string }) => void }) {
  const [quiz, setQuiz] = useState<MemberQuiz | null>(null);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(0);
  const [sending, setSending] = useState(false);
  const draftTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    loadMemberQuiz(taskId).then((next) => { if (active) { setQuiz(next); setAnswers(next.answers); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Не удалось загрузить вопросы."); });
    return () => { active = false; window.clearTimeout(draftTimer.current); };
  }, [taskId]);

  function change(next: QuizAnswers) {
    setAnswers(next); setMissing(0); setError("");
    // Saved quietly a moment after typing stops; a failed save is retried with the next change.
    window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => void saveQuizDraft(taskId, next).catch(() => undefined), DRAFT_DELAY_MS);
  }

  async function send() {
    if (!quiz || sending) return;
    const gap = firstUnanswered(quiz.questions, answers);
    if (gap) {
      setMissing(gap);
      document.getElementById(`quiz-${taskId}-${gap}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    window.clearTimeout(draftTimer.current);
    setSending(true); setError("");
    try {
      const sent = await submitTaskQuiz(taskId, answers);
      if (sent.voice) {
        onVoicePending?.(sent.voice);
        window.location.assign(sent.voice.url);
        return;
      }
      onSubmitted({ score: sent.score, total: sent.total });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось отправить ответы. Попробуйте ещё раз."); }
    finally { setSending(false); }
  }

  if (!quiz) return error ? <p className={styles.error} role="alert">{error}</p> : <p className={styles.muted}>Загружаем вопросы…</p>;
  if (quiz.videoRequired && !quiz.videoCompleted && !videoWatched) return <div className={styles.locked}>
    <span aria-hidden="true">🔒</span>
    <div><strong>{quiz.questions.length} {plural(quiz.questions.length, "вопрос", "вопроса", "вопросов")} после видео</strong><p>Досмотрите видео до конца — вопросы откроются здесь.</p></div>
  </div>;

  return <section className={styles.quiz} aria-label="Вопросы к заданию">
    <h4>Вопросы · {quiz.questions.length}</h4>
    <ol className={styles.list}>
      {quiz.questions.map((question, index) => {
        const answer = answers[question.id] || {};
        const unanswered = missing === index + 1;
        return <li key={question.id} id={`quiz-${taskId}-${index + 1}`} className={`${styles.question} ${unanswered ? styles.missing : ""}`}>
          <p className={styles.prompt}><b>{index + 1}.</b> {question.prompt}</p>
          {question.kind === "text" ? <textarea value={answer.text || ""} rows={4} maxLength={3000} placeholder="Ваш ответ" aria-label={`Ответ на вопрос ${index + 1}`}
            onChange={(event) => change({ ...answers, [question.id]: { text: event.target.value } })} />
          : <div className={styles.options} role={question.kind === "single" ? "radiogroup" : "group"} aria-label={`Варианты к вопросу ${index + 1}`}>
            {question.kind === "multiple" && <small className={styles.muted}>Можно выбрать несколько</small>}
            {(question.options || []).map((option, position) => {
              const checked = (answer.choice || []).includes(position);
              return <label key={position} className={`${styles.option} ${checked ? styles.checked : ""}`}>
                <input type={question.kind === "single" ? "radio" : "checkbox"} name={`quiz-${taskId}-${question.id}`} checked={checked}
                  onChange={() => {
                    const current = answer.choice || [];
                    const choice = question.kind === "single" ? [position] : checked ? current.filter((value) => value !== position) : [...current, position].sort((a, b) => a - b);
                    change({ ...answers, [question.id]: { choice } });
                  }} />
                <span>{option}</span>
              </label>;
            })}
          </div>}
          {unanswered && <p className={styles.error}>Ответьте на этот вопрос</p>}
        </li>;
      })}
    </ol>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <button type="button" className={styles.send} disabled={sending} onClick={() => void send()}>{sending ? (voice ? "Открываем Telegram…" : "Отправляем…") : voice ? "🎙 Ответить и записать голосовое" : "Отправить наставнику"}</button>
    {voice && <p className={styles.muted}>После ответов откроется Telegram: запишите голосовое в течение 30 минут — работа уйдёт наставнику вместе с ответами.</p>}
  </section>;
}
