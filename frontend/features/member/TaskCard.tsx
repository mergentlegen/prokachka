"use client";

import { useState } from "react";
import type { Submission, Task } from "@/shared/domain/types";
import { externalHref, formatDateTime, formatMiles } from "@/frontend/shared/lib/format";
import { PinBadge } from "@/frontend/shared/PublicationPin";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { ResourceCard } from "@/frontend/shared/ResourceCard";
import { TaskAttachments } from "@/frontend/shared/TaskAttachments";
import { DreamPlanGame } from "./DreamPlanGame";
import { StarterRulesGame } from "./StarterRulesGame";
import { HeartSurvey } from "./HeartSurvey";
import styles from "./TaskCard.module.css";

export function TaskCard({ task, submission, onSubmit, onInteractiveComplete, onInteractiveProgress }: { task: Task; submission?: Submission; onSubmit: (id: string) => Promise<void>; onInteractiveComplete?: (submission: Submission) => void; onInteractiveProgress?: () => void }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const isInteractive = Boolean(task.interactiveKind);
  const isSurvey = task.interactiveKind === "heart-survey";
  const surveyInProgress = isSurvey && submission?.interactiveCompleted === false;
  const deadline = task.dueAt || task.deadlineAt;
  const expired = Boolean(deadline && new Date(deadline).getTime() <= Date.now());
  const status = submission?.status || (expired ? "missed" : "new");
  const statusText = surveyInProgress ? `Сохранено ${submission?.points} из 5 ответов` : status === "accepted" ? "Принято" : status === "pending" ? "На проверке" : status === "revision" ? "На доработку" : status === "missed" ? "Срок истёк" : "Не начато";
  const resource = externalHref(task.resourceUrl);
  const canSubmit = task.isActive && status !== "pending" && status !== "accepted" && (!expired || task.publicationType === "sequential");
  async function send() {
    if (sending || !canSubmit) return;
    setOpen(false); setSending(true);
    try { await onSubmit(task.id); } finally { setSending(false); }
  }
  function action(inDetail = false) {
    if (surveyInProgress) return <button className={styles.submit} onClick={() => setOpen(true)}>Продолжить опросник</button>;
    if (status === "accepted") return <strong className={styles.accepted}>+{formatMiles(submission?.points || 0)}</strong>;
    if (status === "pending") return <span className={styles.waiting}>Ответ на проверке</span>;
    if (!canSubmit) return <span className={styles.waiting}>Приём завершён</span>;
    if (isInteractive) return inDetail ? <span className={styles.waiting}>Заверши игру внутри блока выше</span> : <button className={styles.submit} onClick={() => setOpen(true)}>{isSurvey ? "Начать опросник" : "Начать игру"}</button>;
    return <button className={styles.submit} disabled={sending} onClick={() => void send()}>{sending ? "Открываем..." : status === "revision" ? "Отправить повторно" : expired ? "Отправить с опозданием" : "Отправить ответ"}</button>;
  }
  return <>
    <article className={styles.card}>
      {task.isPinned && <PinBadge />}
      <div className={styles.top}><span className={`${styles.status} ${styles[status]}`}>{statusText}</span><span className={styles.points}>до {formatMiles(task.maxPoints)}</span></div>
      <h3><button className={styles.title} onClick={() => setOpen(true)} aria-haspopup="dialog">{task.title}</button></h3>
      <p className={styles.preview}>{task.description}</p>
      {Boolean(task.attachments?.length) && <p className={styles.attachmentHint}>PDF-материалы · {task.attachments?.length} {task.attachments?.length === 1 ? "файл" : "файла"}</p>}
      {deadline && <p className={`${styles.deadline} ${expired ? styles.expired : ""}`}>{expired ? "Срок истёк: " : "До "}{formatDateTime(deadline)}</p>}
      <div className={styles.actions}><button className={styles.read} onClick={() => setOpen(true)} aria-haspopup="dialog">{status === "revision" ? "Комментарий наставника" : isSurvey ? "Открыть опросник" : isInteractive ? "Открыть игру" : "Подробнее"} <span aria-hidden="true">↗</span></button>{action()}</div>
    </article>
    {open && <ModalSheet title={isInteractive ? task.title : "Задание"} variant={isInteractive ? "immersive" : "default"} onClose={() => setOpen(false)}>
      <div className={`${styles.detail} ${isInteractive ? styles.interactiveDetail : ""}`}>
        {!isInteractive && <><div className={styles.top}><span className={`${styles.status} ${styles[status]}`}>{statusText}</span><span className={styles.points}>до {formatMiles(task.maxPoints)}</span></div>
        <h3>{task.title}</h3>
        <div className={styles.description}>{task.description}</div></>}
        {task.interactiveKind === "dream-plan" && <DreamPlanGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "starter-rules" && <StarterRulesGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {isSurvey && <HeartSurvey taskId={task.id} onProgress={onInteractiveProgress} />}
        <TaskAttachments taskId={task.id} attachments={task.attachments} />
        {resource && <ResourceCard url={resource} />}
        {deadline && <p className={`${styles.deadline} ${expired ? styles.expired : ""}`}>Срок: {formatDateTime(deadline)}{expired && canSubmit && <span>Можно отправить с опозданием.</span>}</p>}
        {submission?.comment && <div className={styles.comment}><strong>Комментарий наставника</strong><p>{submission.comment}</p></div>}
        {submission && !isInteractive && <p className={styles.waiting}>Последняя отправка: {formatDateTime(submission.submittedAt)}</p>}
        {!isInteractive && <div className={styles.detailAction}>{action(true)}</div>}
      </div>
    </ModalSheet>}
  </>;
}
