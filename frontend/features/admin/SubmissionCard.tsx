"use client";

import { useState } from "react";
import type { Submission } from "@/shared/domain/types";
import { formatDateTime } from "@/frontend/shared/lib/format";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import styles from "./SubmissionCard.module.css";

type Props = { submission: Submission; name: string; taskTitle: string };

function SubmissionHeader({ submission, name, taskTitle }: Props) {
  return <header className={styles.header}>
    <div className={styles.avatar} aria-hidden="true">{name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("")}</div>
    <div className={styles.identity}><strong>{name}</strong><span>{taskTitle}</span></div>
    <time dateTime={submission.submittedAt}>{formatDateTime(submission.submittedAt)}</time>
  </header>;
}

export function SubmissionAnswer({ submission }: { submission: Submission }) {
  const [showMedia, setShowMedia] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const type = submission.mediaType;
  const hasMedia = type === "photo" || type === "video" || type === "document";
  const mediaUrl = `/api/submissions/${encodeURIComponent(submission.id)}/media`;
  return <div className={styles.answer}>
    {submission.answerText && <div className={styles.text}>{submission.answerText}</div>}
    {!submission.answerText && !hasMedia && <p className={styles.muted}>Текст ответа отсутствует.</p>}
    {hasMedia && <div className={styles.media}>
      {!showMedia ? <button type="button" className={styles.open} onClick={() => setShowMedia(true)}>{type === "photo" ? "Посмотреть фото" : type === "video" ? "Посмотреть видео" : "Посмотреть файл"}</button> : <>
        {failed ? <div className={styles.mediaError} role="alert"><p>Не удалось загрузить вложение.</p><button type="button" className={styles.open} onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>Повторить</button></div> : <>
          {type === "photo" && <a href={mediaUrl} target="_blank" rel="noopener noreferrer" aria-label="Открыть фото в полном размере"><img key={attempt} src={mediaUrl} alt="Ответ участника" onError={() => setFailed(true)} /></a>}
          {type === "video" && <video key={attempt} src={mediaUrl} controls playsInline preload="metadata" onError={() => setFailed(true)} />}
          {type === "document" && <a className={styles.open} href={mediaUrl} target="_blank" rel="noopener noreferrer">Открыть файл ↗</a>}
        </>}
      </>}
    </div>}
  </div>;
}

export function SubmissionCard({ onReview, ...props }: Props & { onReview: (submission: Submission, status: "accepted" | "revision") => void }) {
  return <article className={styles.card}>
    <SubmissionHeader {...props} />
    <SubmissionAnswer submission={props.submission} />
    <footer className={styles.actions}>
      <button type="button" className={styles.accept} onClick={() => onReview(props.submission, "accepted")}>Принять</button>
      <button type="button" className={styles.revise} onClick={() => onReview(props.submission, "revision")}>На доработку</button>
    </footer>
  </article>;
}

export function SubmissionSummary(props: Props) {
  const [open, setOpen] = useState(false);
  return <div className={styles.summary}>
    <SubmissionHeader {...props} />
    {props.submission.answerText && <p className={styles.preview}>{props.submission.answerText}</p>}
    <button type="button" className={styles.open} aria-haspopup="dialog" onClick={() => setOpen(true)}>Открыть ответ ↗</button>
    {open && <ModalSheet title="Ответ участника" onClose={() => setOpen(false)}><SubmissionHeader {...props} /><SubmissionAnswer submission={props.submission} /></ModalSheet>}
  </div>;
}
