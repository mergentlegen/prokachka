"use client";

import { useRef, useState, type CSSProperties } from "react";
import type { Store, Submission } from "@/shared/domain/types";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { formatMiles } from "@/frontend/shared/lib/format";
import { SubmissionAnswer, SubmissionHeader } from "./SubmissionCard";
import { plural } from "./review-queue";
import styles from "./ReviewFlow.module.css";

export const DEFAULT_REVIEW_TEMPLATES = [
  "Отличная работа, так держать!",
  "Хорошо! Добавь, пожалуйста, больше деталей.",
  "Нужно доработать: перечитай задание и дополни ответ.",
];

export type ReviewDecision = { status: "accepted" | "revision"; points: number; comment: string };

// Reviews the queue one work at a time: the answer and the decision are on one screen,
// and saving moves straight to the next work, oldest first.
export function ReviewFlow({ queue, startId, intent, store, templates, canEditTemplates, onSave, onEditTemplates, onClose }: {
  queue: Submission[]; startId: string; intent?: "accepted" | "revision"; store: Store; templates: string[]; canEditTemplates: boolean;
  onSave: (submission: Submission, decision: ReviewDecision) => Promise<boolean>; onEditTemplates: () => void; onClose: () => void;
}) {
  // The work on screen is kept as a snapshot, so it does not vanish while the queue refreshes after saving.
  const [current, setCurrent] = useState<Submission | null>(() => queue.find((item) => item.id === startId) || null);
  const [reviewed, setReviewed] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const remaining = queue.filter((item) => item.id !== current?.id).length + (current ? 1 : 0);
  const total = reviewed + remaining;

  function next(afterId: string, skippedIds = skipped) {
    const rest = queue.filter((item) => item.id !== afterId);
    setCurrent(rest.find((item) => !skippedIds.includes(item.id)) || rest[0] || null);
  }

  return <ModalSheet title="Проверка работ" onClose={onClose}>
    {current ? <div className={styles.flow}>
      <div className={styles.progress}>
        <span>{reviewed ? `Проверено ${reviewed} из ${total}` : `${remaining} ${plural(remaining, "работа ждёт", "работы ждут", "работ ждут")} проверки`}</span>
        <i style={{ "--progress": `${total ? (reviewed / total) * 100 : 0}%` } as CSSProperties} />
      </div>
      <ReviewStep key={current.id} submission={current} store={store} templates={templates} canEditTemplates={canEditTemplates} intent={current.id === startId ? intent : undefined}
        canSkip={remaining > 1} onEditTemplates={onEditTemplates}
        onSkip={() => { const list = [...skipped, current.id]; setSkipped(list); next(current.id, list); }}
        onSave={async (decision) => {
          const saved = await onSave(current, decision);
          if (saved) { setReviewed((value) => value + 1); next(current.id); }
          return saved;
        }} />
    </div> : <Finished reviewed={reviewed} onClose={onClose} />}
  </ModalSheet>;
}

function ReviewStep({ submission, store, templates, canEditTemplates, intent, canSkip, onSkip, onEditTemplates, onSave }: {
  submission: Submission; store: Store; templates: string[]; canEditTemplates: boolean; intent?: "accepted" | "revision"; canSkip: boolean;
  onSkip: () => void; onEditTemplates: () => void; onSave: (decision: ReviewDecision) => Promise<boolean>;
}) {
  const task = store.tasks.find((item) => item.id === submission.taskId);
  const member = store.users.find((user) => user.id === submission.userId);
  const maxPoints = task?.maxPoints ?? submission.taskMaxPoints ?? 0;
  const [points, setPoints] = useState(String(submission.points || maxPoints));
  const [comment, setComment] = useState(submission.comment || "");
  const [busy, setBusy] = useState<"" | "accepted" | "revision">("");
  const [error, setError] = useState("");
  const commentField = useRef<HTMLTextAreaElement>(null);
  const shown = templates.length ? templates : DEFAULT_REVIEW_TEMPLATES;

  function applyTemplate(text: string) {
    setComment((value) => value.trim() ? `${value.trim()} ${text}` : text);
    setError("");
    commentField.current?.focus({ preventScroll: true });
  }

  async function decide(status: "accepted" | "revision") {
    if (busy) return;
    const miles = Number(points);
    if (status === "accepted" && (!Number.isInteger(miles) || miles < 0 || miles > maxPoints)) { setError(`Мили: целое число от 0 до ${maxPoints}.`); return; }
    if (status === "revision" && !comment.trim()) { setError("Напишите участнику, что нужно исправить."); commentField.current?.focus(); return; }
    setBusy(status); setError("");
    const saved = await onSave({ status, points: status === "accepted" ? miles : 0, comment: comment.trim() });
    if (!saved) setBusy("");
  }

  return <div className={styles.step}>
    <SubmissionHeader submission={submission} name={member?.name || "Неизвестный участник"} avatarUrl={member?.avatarUrl} taskTitle={submission.taskTitle || task?.title || "Удалённое задание"} />
    <SubmissionAnswer submission={submission} />

    <div className={styles.decision}>
      <label className={styles.miles}><span>Мили <small>максимум {formatMiles(maxPoints)}</small></span>
        <input type="number" inputMode="numeric" min="0" max={maxPoints} step="1" value={points} onChange={(event) => { setPoints(event.target.value); setError(""); }} />
      </label>
      <div className={styles.comment}>
        <label htmlFor={`review-comment-${submission.id}`}>Комментарий участнику {intent === "revision" && <small>что нужно доработать</small>}</label>
        <div className={styles.templates} aria-label="Готовые комментарии">
          {shown.map((text) => <button type="button" key={text} onClick={() => applyTemplate(text)}>{text}</button>)}
          {canEditTemplates && <button type="button" className={styles.edit} onClick={onEditTemplates}>Настроить</button>}
        </div>
        <textarea id={`review-comment-${submission.id}`} ref={commentField} rows={3} value={comment}
          onChange={(event) => { setComment(event.target.value); setError(""); }} placeholder="Что получилось хорошо, что улучшить" />
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>

    <div className={styles.actions}>
      <button type="button" className={styles.revise} disabled={Boolean(busy)} onClick={() => void decide("revision")}>{busy === "revision" ? "Сохраняем..." : "На доработку"}</button>
      <button type="button" className={styles.accept} disabled={Boolean(busy)} onClick={() => void decide("accepted")}>{busy === "accepted" ? "Сохраняем..." : `Принять · ${formatMiles(Number(points) || 0)}`}</button>
      {canSkip && <button type="button" className={styles.skip} disabled={Boolean(busy)} onClick={onSkip}>Пропустить, проверю позже →</button>}
    </div>
  </div>;
}

const colors = ["#e7b85b", "#3151a3", "#24866d", "#d68d15", "#8fa8ec"];

function Finished({ reviewed, onClose }: { reviewed: number; onClose: () => void }) {
  return <div className={styles.finished}>
    {reviewed > 0 && <div className={styles.confetti} aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} style={{
      "--x": `${(index * 41) % 100}%`, "--delay": `${(index % 8) * 0.06}s`, "--spin": `${(index % 2 ? 1 : -1) * (200 + (index * 47) % 300)}deg`, "--color": colors[index % colors.length],
    } as CSSProperties} />)}</div>}
    <span className={styles.check} aria-hidden="true">✓</span>
    <h3>{reviewed ? "Все работы проверены!" : "Нет работ на проверку"}</h3>
    <p>{reviewed ? `Проверено ${reviewed} ${plural(reviewed, "работа", "работы", "работ")}. Участники увидят ответ в своём кабинете.` : "Когда участники отправят новые ответы, они появятся здесь."}</p>
    <button type="button" className={styles.accept} onClick={onClose}>Готово</button>
  </div>;
}
