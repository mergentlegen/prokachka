"use client";

import { useState, type CSSProperties } from "react";
import type { Submission, Task } from "@/shared/domain/types";
import { externalHref, formatDateTime, formatMiles } from "@/frontend/shared/lib/format";
import { PinBadge } from "@/frontend/shared/PublicationPin";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { ResourceCard } from "@/frontend/shared/ResourceCard";
import { TaskAttachments } from "@/frontend/shared/TaskAttachments";
import { recordTaskLinkOpen } from "@/frontend/shared/api/client";
import { DreamPlanGame } from "./DreamPlanGame";
import { StarterRulesGame } from "./StarterRulesGame";
import { HeartSurvey } from "./HeartSurvey";
import { CompanyVoyageGame } from "./CompanyVoyageGame";
import { CaptainCruiseGame } from "./CaptainCruiseGame";
import { CountYourDreamGame } from "./CountYourDreamGame";
import { DreamRouteGame } from "./DreamRouteGame";
import { FirstYearGame } from "./FirstYearGame";
import { deadlineInfo } from "./member-progress";
import { ProtectedVideo } from "@/frontend/shared/ProtectedVideo";
import { QuizSentNotice, TaskQuiz } from "./TaskQuiz";
import { formatVideoTime } from "@/shared/domain/task-video";
import styles from "./TaskCard.module.css";

export function TaskCard({ task, submission, onSubmit, onFeedback, onInteractiveComplete, onInteractiveProgress }: { task: Task; submission?: Submission; onSubmit: (id: string) => Promise<void>; onFeedback?: (taskId: string) => void; onInteractiveComplete?: (submission: Submission) => void; onInteractiveProgress?: () => void }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [linkOpened, setLinkOpened] = useState(false);
  const isInteractive = Boolean(task.interactiveKind);
  const isSurvey = task.interactiveKind === "heart-survey";
  // Questions on the site replace the Telegram answer for this task.
  const isQuiz = Boolean(task.quiz) && !isInteractive;
  const [videoWatched, setVideoWatched] = useState(false);
  const [quizSent, setQuizSent] = useState<{ score: number; total: number } | null>(null);
  const surveyInProgress = isSurvey && submission?.interactiveCompleted === false;
  const captainPending = task.interactiveKind === "captain-cruise" && submission?.interactiveCompleted === false;
  const deadline = task.dueAt || task.deadlineAt;
  const expired = Boolean(deadline && new Date(deadline).getTime() <= Date.now());
  const status = submission?.status || (expired ? "missed" : "new");
  const statusText = captainPending ? "Тренировка пройдена · ждём скриншот" : surveyInProgress ? `Сохранено ${submission?.points} из 5 ответов` : status === "accepted" ? "Принято" : status === "pending" ? "На проверке" : status === "revision" ? "На доработку" : status === "missed" ? "Срок истёк" : "Не начато";
  const countdown = deadlineInfo(deadline);
  const step = task.publicationType === "sequential" && task.position ? task.position : undefined;
  const resource = externalHref(task.resourceUrl);
  const canSubmit = task.isActive && status !== "pending" && status !== "accepted" && (!expired || task.publicationType === "sequential");
  const submitLabel = status === "revision" ? "Отправить повторно" : expired ? "Отправить с опозданием" : "Отправить ответ";
  function openedResource() {
    if (!canSubmit || isInteractive) return;
    setLinkOpened(true);
    recordTaskLinkOpen(task.id);
  }
  async function send() {
    if (sending || !canSubmit) return;
    setOpen(false); setSending(true);
    try { await onSubmit(task.id); } finally { setSending(false); }
  }
  function action(inDetail = false) {
    if (captainPending) return <button className={styles.submit} onClick={() => setOpen(true)}>Отправить скриншот · +1 миля</button>;
    if (surveyInProgress) return <button className={styles.submit} onClick={() => setOpen(true)}>Продолжить опросник</button>;
    if (status === "accepted") return <strong className={styles.accepted}>+{formatMiles(submission?.points || 0)}</strong>;
    if (status === "pending") return <span className={styles.waiting}>Ответ на проверке</span>;
    if (!canSubmit) return <span className={styles.waiting}>Приём завершён</span>;
    if (isQuiz) return inDetail ? null : <button className={styles.submit} onClick={() => setOpen(true)}>{status === "revision" ? "Исправить ответы" : "Ответить на вопросы"}</button>;
    if (isInteractive) return inDetail ? <span className={styles.waiting}>Заверши игру внутри блока выше</span> : <button className={styles.submit} onClick={() => setOpen(true)}>{isSurvey ? "Начать опросник" : "Начать игру"}</button>;
    return <button className={styles.submit} disabled={sending} onClick={() => void send()}>{sending ? "Открываем..." : submitLabel}</button>;
  }
  return <>
    <article className={styles.card}>
      {task.isPinned && <PinBadge />}
      <div className={styles.top}><span className={`${styles.status} ${styles[status]}`}>{statusText}</span><span className={styles.points}>до {formatMiles(task.maxPoints)}</span></div>
      {step && <div className={styles.program}><span>{task.programTitle ? `«${task.programTitle}» · ` : "Программа · "}шаг {step}{task.programSteps ? ` из ${task.programSteps}` : ""}</span>{task.programSteps && <i style={{ "--progress": `${Math.max(4, Math.min(100, ((step - 1) / task.programSteps) * 100))}%` } as CSSProperties} />}</div>}
      <h3><button className={styles.title} onClick={() => setOpen(true)} aria-haspopup="dialog">{task.title}</button></h3>
      <p className={styles.preview}>{task.description}</p>
      {isQuiz && <p className={styles.videoHint}><span aria-hidden="true">?</span>Вопросы · {task.quiz?.questions}</p>}
      {task.video?.playable && <p className={styles.videoHint}><span aria-hidden="true">▶</span>Видео{task.video.durationSeconds ? ` · ${formatVideoTime(task.video.durationSeconds)}` : ""}</p>}
      {Boolean(task.attachments?.length) && <p className={styles.attachmentHint}>PDF-материалы · {task.attachments?.length} {task.attachments?.length === 1 ? "файл" : "файла"}</p>}
      {deadline && (countdown && canSubmit && !captainPending && !surveyInProgress
        ? <p className={`${styles.countdown} ${styles[countdown.tone]}`}><span>{countdown.text}</span><small>{countdown.tone === "expired" ? "можно отправить с опозданием" : `до ${formatDateTime(deadline)}`}</small></p>
        : <p className={`${styles.deadline} ${expired ? styles.expired : ""}`}>{expired ? "Срок истёк: " : "До "}{formatDateTime(deadline)}</p>)}
      <div className={styles.actions}><button className={styles.read} onClick={() => setOpen(true)} aria-haspopup="dialog">{status === "revision" ? "Комментарий наставника" : isSurvey ? "Открыть опросник" : isInteractive ? "Открыть игру" : "Подробнее"} <span aria-hidden="true">↗</span></button>{action()}</div>
    </article>
    {open && <ModalSheet title={isInteractive ? task.title : "Задание"} variant={isInteractive ? "immersive" : "default"} onClose={() => setOpen(false)}>
      <div className={`${styles.detail} ${isInteractive ? styles.interactiveDetail : ""}`}>
        {!isInteractive && <><div className={styles.top}><span className={`${styles.status} ${styles[status]}`}>{statusText}</span><span className={styles.points}>до {formatMiles(task.maxPoints)}</span></div>
        <h3>{task.title}</h3>
        <div className={styles.description}>{task.description}</div></>}
        {task.interactiveKind === "dream-plan" && <DreamPlanGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "first-year" && <FirstYearGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "starter-rules" && <StarterRulesGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "company-voyage" && <CompanyVoyageGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "captain-cruise" && <CaptainCruiseGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "count-your-dream" && <CountYourDreamGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "dream-route" && <DreamRouteGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {isSurvey && <HeartSurvey taskId={task.id} onProgress={onInteractiveProgress} />}
        {task.video?.playable && <ProtectedVideo taskId={task.id} onCompleted={() => setVideoWatched(true)} />}
        {quizSent ? <QuizSentNotice score={quizSent.score} total={quizSent.total} />
          : isQuiz && canSubmit && <TaskQuiz taskId={task.id} videoWatched={videoWatched} onSubmitted={(result) => { setQuizSent(result); onInteractiveProgress?.(); }} />}
        <TaskAttachments taskId={task.id} attachments={task.attachments} />
        {resource && <ResourceCard url={resource} onOpen={openedResource} />}
        {linkOpened && canSubmit && !isQuiz && <div className={styles.returnHint} role="status"><strong>Уже выполнили?</strong><p>Нажмите «{submitLabel}» ниже. Без этого наставник не увидит работу, не даст обратную связь и не начислит мили.</p></div>}
        {deadline && <p className={`${styles.deadline} ${expired ? styles.expired : ""}`}>Срок: {formatDateTime(deadline)}{expired && canSubmit && <span>Можно отправить с опозданием.</span>}</p>}
        {submission?.comment && <div className={styles.comment}><strong>Комментарий наставника</strong><p>{submission.comment}</p></div>}
        {submission && !isInteractive && onFeedback && <button type="button" className={styles.read} onClick={() => { setOpen(false); onFeedback(task.id); }}>Открыть переписку с наставником →</button>}
        {submission && !isInteractive && <p className={styles.waiting}>Последняя отправка: {formatDateTime(submission.submittedAt)}</p>}
        {!isInteractive && !(isQuiz && (canSubmit || quizSent)) && <div className={styles.detailAction}>{action(true)}</div>}
      </div>
    </ModalSheet>}
  </>;
}
