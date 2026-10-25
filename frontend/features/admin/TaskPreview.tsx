"use client";

import type { QuizQuestion } from "@/shared/domain/task-quiz";
import { ResourceCard } from "@/frontend/shared/ResourceCard";
import { formatDateTime, formatMiles } from "@/frontend/shared/lib/format";
import { deadlineLabel, validLink, type EditorValue } from "./task-editor";
import styles from "./TaskPreview.module.css";

const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;

/**
 * «Так увидит участник»: the task as it will open for a participant, built from what is typed right now —
 * description, then materials, then questions and the answer button. Nothing here is clickable.
 */
export function TaskPreview({ value, mode, stepDeadlineHours, video, pdfs, questions, interactive = false }: {
  value: EditorValue; mode: "task" | "step"; stepDeadlineHours?: number;
  /** A video name, or a word about the uploaded one; null — no video. */
  video: string | null;
  pdfs: Array<{ name: string; size: number }>;
  questions: QuizQuestion[];
  interactive?: boolean;
}) {
  const deadline = mode === "step"
    ? stepDeadlineHours ? `${deadlineLabel(stepDeadlineHours)} на шаг` : ""
    : value.hasDeadline && value.deadline && !Number.isNaN(new Date(value.deadline).getTime()) ? formatDateTime(new Date(value.deadline).toISOString()) : "";
  const link = value.resourceUrl.trim() && validLink(value.resourceUrl) ? value.resourceUrl.trim() : "";
  const answer = interactive ? "" : questions.length ? value.voiceAnswer ? "Ответить и записать голосовое" : "Отправить наставнику" : value.voiceAnswer ? "🎙️ Записать голосовое" : "Отправить ответ";
  return <div className={styles.preview} aria-label="Предпросмотр задания для участника" role="img">
    <div className={styles.top}><span className={styles.status}>Не начато</span><span className={styles.points}>до {formatMiles(Number(value.maxPoints) || 0)}</span></div>
    <h4 className={value.title.trim() ? "" : styles.placeholder}>{value.title.trim() || "Название задания"}</h4>
    <p className={`${styles.description} ${value.description.trim() ? "" : styles.placeholder}`}>{value.description.trim() || "Здесь будет описание: что сделать и как ответить."}</p>
    {deadline && <p className={styles.deadline}>Срок: {deadline}</p>}

    {video && <div className={styles.video}><span aria-hidden="true">▶</span><small>{video}</small></div>}
    {pdfs.length > 0 && <div className={styles.files}>
      <b>Материалы к заданию</b>
      {pdfs.map((file, index) => <div key={`${file.name}-${index}`} className={styles.file}>
        <span className={styles.fileIcon}>PDF</span>
        <span className={styles.fileInfo}><strong>{file.name}</strong><small>{size(file.size)}</small></span>
        <span className={styles.fileButton}>Открыть PDF</span>
      </div>)}
    </div>}
    {link && <ResourceCard url={link} />}

    {questions.length > 0 && <div className={styles.quiz}>
      <b>Вопросы · {questions.length}</b>
      <ol>{questions.map((question) => <li key={question.id}>
        <strong>{question.prompt.trim() || "Текст вопроса"}</strong>
        {question.kind === "text" ? <span className={styles.textAnswer}>Ответ своими словами</span>
          : <ul>{(question.options || []).map((option, index) => <li key={index}><i className={question.kind === "multiple" ? styles.square : ""} />{option.trim() || `Вариант ${index + 1}`}</li>)}</ul>}
      </li>)}</ol>
    </div>}
    {answer && <span className={styles.answer}>{answer}</span>}
    {!interactive && !questions.length && <small className={styles.hint}>{value.voiceAnswer ? "Бот в Telegram примет только голосовое сообщение." : "Ответ отправляется через Telegram-бота: текст, фото, видео или файл."}</small>}
  </div>;
}
