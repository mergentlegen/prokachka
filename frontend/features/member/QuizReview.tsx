"use client";

import { useEffect, useState } from "react";
import { loadQuizReview, type QuizReview as Review } from "@/frontend/shared/api/task-quiz-client";
import styles from "./QuizReview.module.css";

// A passed test, read-only: every question with the participant's choice, the correct one and their text answers.
export function QuizReview({ taskId }: { taskId: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    loadQuizReview(taskId).then((next) => { if (active) setReview(next); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Не удалось загрузить ответы."); });
    return () => { active = false; };
  }, [taskId]);
  if (error) return <p className={styles.note}>{error}</p>;
  if (!review) return <p className={styles.note}>Загружаем ваши ответы…</p>;
  return <QuizReviewList review={review} />;
}

export function QuizReviewList({ review }: { review: Review }) {
  return <section className={styles.review} aria-label="Ваши ответы на тест">
    <div className={styles.head}><strong>Ваши ответы</strong>{review.total ? <span>{review.score ?? 0} из {review.total} верно</span> : null}</div>
    <ol className={styles.questions}>
      {review.questions.map((question, index) => {
        const answer = review.answers[question.id] || {};
        if (question.kind === "text") return <li key={question.id}>
          <p className={styles.prompt}><b>{index + 1}.</b> {question.prompt}</p>
          <p className={styles.text}>{answer.text?.trim() || "Без ответа"}</p>
        </li>;
        const chosen = new Set(answer.choice || []);
        const correct = new Set(question.correct || []);
        const right = chosen.size === correct.size && [...correct].every((value) => chosen.has(value));
        return <li key={question.id}>
          <p className={styles.prompt}><b>{index + 1}.</b> {question.prompt}<em className={right ? styles.okMark : styles.badMark}>{right ? "верно" : "ошибка"}</em></p>
          <ul className={styles.options}>
            {(question.options || []).map((option, choice) => {
              const isCorrect = correct.has(choice), picked = chosen.has(choice);
              return <li key={choice} className={isCorrect ? styles.correct : picked ? styles.wrong : ""}>
                <span className={styles.mark} aria-hidden="true">{isCorrect ? "✓" : picked ? "✕" : ""}</span>
                <span>{option}</span>
                {picked && <small>{isCorrect ? "ваш ответ" : "ваш ответ, неверно"}</small>}
                {!picked && isCorrect && <small>правильный ответ</small>}
              </li>;
            })}
          </ul>
        </li>;
      })}
    </ol>
  </section>;
}
