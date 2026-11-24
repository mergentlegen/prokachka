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
import { SafetyWatchGame } from "./SafetyWatchGame";
import { FreeMembershipGame } from "./FreeMembershipGame";
import { MarketingDirectorGame } from "./MarketingDirectorGame";
import { FinalVoyageGame } from "./FinalVoyageGame";
import { ObjectionTrainer } from "./ObjectionTrainer";
import { PODUMAYU_TRAINER } from "@/shared/domain/podumayu";
import { DOROGO_TRAINER } from "@/shared/domain/dorogo";
import { PIRAMIDA_TRAINER } from "@/shared/domain/piramida";
import { GARANTII_TRAINER } from "@/shared/domain/garantii";
import { BALLY_TRAINER } from "@/shared/domain/bally";
import { DESHEVLE_TRAINER } from "@/shared/domain/deshevle";
import { STRAH_TRAINER } from "@/shared/domain/strah";
import { VREMYA_TRAINER } from "@/shared/domain/vremya";
import { SEMYA_TRAINER } from "@/shared/domain/semya";
import { deadlineInfo } from "./member-progress";
import { ProtectedVideo } from "@/frontend/shared/ProtectedVideo";
import { QuizPreview, QuizResultPopup, QuizSentNotice, TaskQuiz, VoicePendingNotice, type QuizResult } from "./TaskQuiz";
import { CaptainCruiseMaterial, FirstYearMaterial, FreeMembershipMaterial, MarketingDirectorMaterial, MaterialButton, SafetyWatchMaterial } from "./GameMaterial";
import { QuizReview } from "./QuizReview";
import { formatVideoTime } from "@/shared/domain/task-video";
import styles from "./TaskCard.module.css";

// Games of an earlier level that were never played: the ones with a reading page open it.
const ARCHIVE_MATERIAL: Record<string, typeof FirstYearMaterial> = {
  "captain-cruise": CaptainCruiseMaterial, "safety-watch": SafetyWatchMaterial, "first-year": FirstYearMaterial, "free-membership": FreeMembershipMaterial, "marketing-director": MarketingDirectorMaterial,
};

export function TaskCard({ task, submission, onSubmit, onFeedback, onInteractiveComplete, onInteractiveProgress, inModule = false, readOnly = false, sheetOnly = false, onClose }: { task: Task; submission?: Submission; onSubmit: (id: string) => Promise<void>; onFeedback?: (taskId: string) => void; onInteractiveComplete?: (submission: Submission) => void; onInteractiveProgress?: () => void; /** Inside a program module the step line is already shown around the card. */ inModule?: boolean; /** An earlier level: materials only; only a work the mentor returned can be sent again. */ readOnly?: boolean;
  /** A passed program step: no card, the window with the whole material opens at once; `onClose` when it is closed. */ sheetOnly?: boolean; onClose?: () => void }) {
  const [open, setOpenState] = useState(sheetOnly);
  function setOpen(value: boolean) {
    setOpenState(value);
    if (!value && sheetOnly) onClose?.();
  }
  const [material, setMaterial] = useState(false);
  const [sending, setSending] = useState(false);
  const [linkOpened, setLinkOpened] = useState(false);
  const isInteractive = Boolean(task.interactiveKind);
  const isSurvey = task.interactiveKind === "heart-survey";
  // Questions on the site replace the Telegram answer for this task.
  const isQuiz = Boolean(task.quiz) && !isInteractive;
  const [videoWatched, setVideoWatched] = useState(false);
  const [quizSent, setQuizSent] = useState<QuizResult | null>(null);
  // The mentor's text after a test checked by itself pops up over the task; the list refreshes once it is closed,
  // so a program step that opens the next one does not take the window away before it is read.
  const [quizPopup, setQuizPopup] = useState<QuizResult | null>(null);
  // A voice task with a test: the answers are saved, the voice message is still to come in Telegram.
  const [voicePending, setVoicePending] = useState<{ url: string; expiresAt: string } | null>(null);
  const surveyInProgress = isSurvey && submission?.interactiveCompleted === false;
  const captainPending = task.interactiveKind === "captain-cruise" && submission?.interactiveCompleted === false;
  const deadline = task.dueAt || task.deadlineAt;
  const expired = Boolean(deadline && new Date(deadline).getTime() <= Date.now());
  const status = submission?.status || (expired ? "missed" : "new");
  const statusText = captainPending ? "Тренировка пройдена · ждём скриншот" : surveyInProgress ? `Сохранено ${submission?.points} из 5 ответов` : status === "accepted" ? "Принято" : status === "pending" ? "На проверке" : status === "revision" ? "На доработку" : status === "missed" ? "Срок истёк" : "Не начато";
  const countdown = deadlineInfo(deadline);
  const step = !inModule && task.publicationType === "sequential" && task.position ? task.position : undefined;
  const resource = externalHref(task.resourceUrl);
  // In the archive (an earlier level) nothing new is sent; a work the mentor returned for changes still can be.
  const locked = readOnly && status !== "revision";
  // A passed game opens as usual (its result and material); an unplayed game of an earlier level is not started.
  const gameDone = isInteractive && status === "accepted" && submission?.interactiveCompleted !== false;
  const showGame = !readOnly || gameDone;
  const ArchiveMaterial = readOnly && !gameDone ? ARCHIVE_MATERIAL[task.interactiveKind || ""] : undefined;
  const canSubmit = !locked && task.isActive && status !== "pending" && status !== "accepted" && (!expired || task.publicationType === "sequential");
  // A voice task opens Telegram for one voice message.
  const submitLabel = task.voiceAnswer
    ? status === "revision" ? "🎙️ Записать голосовое заново" : expired ? "🎙️ Записать голосовое с опозданием" : "🎙️ Записать голосовое"
    : status === "revision" ? "Отправить повторно" : expired ? "Отправить с опозданием" : "Отправить ответ";
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
  function quizSubmitted(result: QuizResult) {
    setQuizSent(result);
    if (result.message) setQuizPopup(result);
    else onInteractiveProgress?.();
  }
  function closeQuizPopup() {
    setQuizPopup(null);
    onInteractiveProgress?.();
  }
  /** Returned with a mistake: the test opens again with the last answers filled in; which ones were wrong is not shown. */
  function retakeQuiz() {
    if (quizPopup) closeQuizPopup();
    setQuizSent(null);
  }
  function action(inDetail = false) {
    if (locked && status !== "accepted" && status !== "pending") return <span className={styles.waiting}>Архив · только просмотр</span>;
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
    {!sheetOnly && <article className={styles.card} id={"task-" + task.id}>
      {task.isPinned && <PinBadge />}
      <div className={styles.top}><span className={`${styles.status} ${styles[status]}`}>{statusText}</span><span className={styles.points}>до {formatMiles(task.maxPoints)}</span></div>
      {step && <div className={styles.program}><span>{task.programTitle ? `«${task.programTitle}» · ` : "Программа · "}шаг {step}{task.programSteps ? ` из ${task.programSteps}` : ""}</span>{task.programSteps && <i style={{ "--progress": `${Math.max(4, Math.min(100, ((step - 1) / task.programSteps) * 100))}%` } as CSSProperties} />}</div>}
      <h3><button className={styles.title} onClick={() => setOpen(true)} aria-haspopup="dialog">{task.title}</button></h3>
      <p className={styles.preview}>{task.description}</p>
      {isQuiz && <p className={styles.videoHint}><span aria-hidden="true">?</span>Вопросы · {task.quiz?.questions}</p>}
      {task.voiceAnswer && !isInteractive && <p className={styles.videoHint}><span aria-hidden="true">🎙️</span>Ответ — голосовое сообщение в Telegram</p>}
      {task.video?.playable && <p className={styles.videoHint}><span aria-hidden="true">▶</span>Видео{task.video.durationSeconds ? ` · ${formatVideoTime(task.video.durationSeconds)}` : ""}</p>}
      {Boolean(task.attachments?.length) && <p className={styles.attachmentHint}>PDF-материалы · {task.attachments?.length} {task.attachments?.length === 1 ? "файл" : "файла"}</p>}
      {deadline && (countdown && canSubmit && !captainPending && !surveyInProgress
        ? <p className={`${styles.countdown} ${styles[countdown.tone]}`}><span>{countdown.text}</span><small>{countdown.tone === "expired" ? "можно отправить с опозданием" : `до ${formatDateTime(deadline)}`}</small></p>
        : <p className={`${styles.deadline} ${expired ? styles.expired : ""}`}>{expired ? "Срок истёк: " : "До "}{formatDateTime(deadline)}</p>)}
      <div className={styles.actions}>{status === "accepted" && !captainPending && !surveyInProgress && !(readOnly && isInteractive && !gameDone)
          ? <button className={`${styles.read} ${styles.readMaterial}`} onClick={() => setOpen(true)} aria-haspopup="dialog"><span className={styles.readIcon} aria-hidden="true">📖</span>{isInteractive ? "Материал игры" : "Материал задания"}</button>
          : <button className={styles.read} onClick={() => setOpen(true)} aria-haspopup="dialog">{status === "revision" ? "Комментарий наставника" : isSurvey ? "Открыть опросник" : isInteractive ? "Открыть игру" : "Подробнее"} <span aria-hidden="true">↗</span></button>}{action()}</div>
    </article>}
    {open && <ModalSheet title={isInteractive ? task.title : "Задание"} variant={isInteractive ? "immersive" : "default"} onClose={() => setOpen(false)}>
      <div className={`${styles.detail} ${isInteractive ? styles.interactiveDetail : ""}`}>
        {(!isInteractive || !showGame) && <><div className={styles.top}><span className={`${styles.status} ${styles[status]}`}>{statusText}</span><span className={styles.points}>до {formatMiles(task.maxPoints)}</span></div>
        <h3>{task.title}</h3>
        <div className={styles.description}>{task.description}</div></>}
        {deadline && <p className={`${styles.deadline} ${expired ? styles.expired : ""}`}>Срок: {formatDateTime(deadline)}{expired && canSubmit && <span>Можно отправить с опозданием.</span>}</p>}
        {!showGame && <p className={styles.waiting}>Игра прошлого уровня: пройти её уже нельзя{ArchiveMaterial ? ", но материал можно прочитать." : "."}</p>}
        {ArchiveMaterial && (material ? <ArchiveMaterial onBack={() => setMaterial(false)} archive />
          : <MaterialButton onClick={() => setMaterial(true)} hint="Игра прошлого уровня — только чтение" />)}
        {/* Materials come first (video, PDF, link), then the game or the test, then the answer. */}
        {task.video?.playable && <ProtectedVideo taskId={task.id} onCompleted={() => setVideoWatched(true)} />}
        <TaskAttachments taskId={task.id} attachments={task.attachments} />
        {resource && <ResourceCard url={resource} onOpen={openedResource} />}
        {showGame && <>{task.interactiveKind === "dream-plan" && <DreamPlanGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "first-year" && <FirstYearGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "safety-watch" && <SafetyWatchGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "free-membership" && <FreeMembershipGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "marketing-director" && <MarketingDirectorGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "final-voyage-1" && <FinalVoyageGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "podumayu" && <ObjectionTrainer trainer={PODUMAYU_TRAINER} taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "dorogo" && <ObjectionTrainer trainer={DOROGO_TRAINER} taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "piramida" && <ObjectionTrainer trainer={PIRAMIDA_TRAINER} taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "garantii" && <ObjectionTrainer trainer={GARANTII_TRAINER} taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "bally" && <ObjectionTrainer trainer={BALLY_TRAINER} taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "deshevle" && <ObjectionTrainer trainer={DESHEVLE_TRAINER} taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "strah" && <ObjectionTrainer trainer={STRAH_TRAINER} taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "vremya" && <ObjectionTrainer trainer={VREMYA_TRAINER} taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "semya" && <ObjectionTrainer trainer={SEMYA_TRAINER} taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "starter-rules" && <StarterRulesGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "company-voyage" && <CompanyVoyageGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "captain-cruise" && <CaptainCruiseGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "count-your-dream" && <CountYourDreamGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {task.interactiveKind === "dream-route" && <DreamRouteGame taskId={task.id} onCompleted={onInteractiveComplete} />}
        {isSurvey && <HeartSurvey taskId={task.id} onProgress={onInteractiveProgress} />}</>}
        {quizSent ? <QuizSentNotice {...quizSent} onRetry={quizSent.returned && canSubmit ? retakeQuiz : undefined} />
          : voicePending && canSubmit ? <VoicePendingNotice url={voicePending.url} expiresAt={voicePending.expiresAt} onExpired={() => setVoicePending(null)} />
          : isQuiz && canSubmit && <TaskQuiz taskId={task.id} videoWatched={videoWatched} voice={task.voiceAnswer} onVoicePending={setVoicePending} onSubmitted={quizSubmitted} />}
        {isQuiz && status === "accepted" && <QuizReview taskId={task.id} />}
        {isQuiz && readOnly && !canSubmit && !quizSent && status !== "accepted" && <QuizPreview taskId={task.id} />}
        {!isQuiz && !isInteractive && submission?.answerText && <div className={styles.answer}><strong>Ваш ответ</strong><p>{submission.answerText}</p></div>}
        {linkOpened && canSubmit && !isQuiz && <div className={styles.returnHint} role="status"><strong>Уже выполнили?</strong><p>Нажмите «{submitLabel}» ниже. Без этого наставник не увидит работу, не даст обратную связь и не начислит мили.</p></div>}
        {submission?.comment && !quizSent?.message && <div className={styles.comment}><strong>Комментарий наставника</strong><p>{submission.comment}</p></div>}
        {submission && !isInteractive && onFeedback && <button type="button" className={styles.read} onClick={() => { setOpen(false); onFeedback(task.id); }}>Открыть переписку с наставником →</button>}
        {submission && !isInteractive && <p className={styles.waiting}>Последняя отправка: {formatDateTime(submission.submittedAt)}</p>}
        {(!isInteractive || !showGame) && !(isQuiz && (canSubmit || quizSent)) && <div className={styles.detailAction}>{action(true)}</div>}
      </div>
    </ModalSheet>}
    {/* Beside the task window, not inside it: Escape closes this window only. */}
    {quizPopup && <QuizResultPopup result={quizPopup} onClose={closeQuizPopup} onRetry={retakeQuiz} />}
  </>;
}
