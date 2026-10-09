"use client";

import { useState } from "react";
import { request } from "@/frontend/shared/api/client";
import { Avatar } from "@/frontend/shared/Avatar";
import type { Submission } from "@/shared/domain/types";
import { formatDateTime } from "@/frontend/shared/lib/format";
import { waitingInfo } from "./review-queue";
import styles from "./SubmissionCard.module.css";

type Props = { submission: Submission; name: string; avatarUrl?: string; taskTitle: string };

export function SubmissionHeader({ submission, name, avatarUrl, taskTitle }: Props) {
  const waiting = submission.status === "pending" ? waitingInfo(submission.submittedAt) : null;
  return <header className={styles.header}>
    <Avatar className={styles.avatar} name={name} src={avatarUrl} />
    <div className={styles.identity}><strong>{name}</strong><span>{taskTitle}</span></div>
    <div className={styles.when}><time dateTime={submission.submittedAt}>{formatDateTime(submission.submittedAt)}</time>{waiting && <span className={`${styles.wait} ${styles[waiting.tone]}`}>{waiting.text}</span>}</div>
  </header>;
}

// Old reviewed answers arrive as a preview; the rest of the text loads only when someone wants to read it.
function AnswerText({ submission }: { submission: Submission }) {
  const [full, setFull] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  async function expand() {
    setState("loading");
    try {
      const body = await request<{ answerText: string }>(`/api/submissions/${encodeURIComponent(submission.id)}/answer`, { cache: "no-store" });
      setFull(body.answerText); setState("idle");
    } catch { setState("failed"); }
  }
  const truncated = submission.answerTruncated && full === null;
  return <div className={styles.text}>
    {full ?? submission.answerText}{truncated && "…"}
    {truncated && <button type="button" className={styles.more} disabled={state === "loading"} onClick={() => void expand()}>
      {state === "loading" ? "Загружаем…" : state === "failed" ? "Не удалось загрузить. Повторить" : "Показать полностью"}</button>}
  </div>;
}

export function SubmissionAnswer({ submission }: { submission: Submission }) {
  const [showMedia, setShowMedia] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const type = submission.mediaType;
  const hasMedia = type === "photo" || type === "video" || type === "document" || type === "voice";
  const mediaUrl = `/api/submissions/${encodeURIComponent(submission.id)}/media`;
  return <div className={styles.answer}>
    {submission.answerText && <AnswerText key={submission.id} submission={submission} />}
    {!submission.answerText && !hasMedia && <p className={styles.muted}>Текст ответа отсутствует.</p>}
    {hasMedia && <div className={styles.media}>
      {!showMedia ? <button type="button" className={styles.open} onClick={() => setShowMedia(true)}>{type === "photo" ? "Посмотреть фото" : type === "video" ? "Посмотреть видео" : type === "voice" ? "▶ Послушать голосовое" : "Посмотреть файл"}</button> : <>
        {failed ? <div className={styles.mediaError} role="alert"><p>Не удалось загрузить вложение.</p><button type="button" className={styles.open} onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>Повторить</button></div> : <>
          {type === "photo" && <a href={mediaUrl} target="_blank" rel="noopener noreferrer" aria-label="Открыть фото в полном размере"><img key={attempt} src={mediaUrl} alt="Ответ участника" onError={() => setFailed(true)} /></a>}
          {type === "video" && <video key={attempt} src={mediaUrl} controls playsInline preload="metadata" onError={() => setFailed(true)} />}
          {type === "document" && <a className={styles.open} href={mediaUrl} target="_blank" rel="noopener noreferrer">Открыть файл ↗</a>}
          {type === "voice" && <><audio key={attempt} src={mediaUrl} controls preload="metadata" onError={() => setFailed(true)} />
            <p className={styles.muted}>Не играет на этом устройстве? Это голосовое продублировано вам в Telegram.</p></>}
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
