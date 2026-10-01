"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { Store, Submission, Task, User } from "@/shared/domain/types";
import { Avatar } from "@/frontend/shared/Avatar";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { formatDateTime, formatMiles } from "@/frontend/shared/lib/format";
import { participantStatusText, taskParticipantResults, taskProgress, type ParticipantStatus } from "./task-results";
import styles from "./TaskResultsSheet.module.css";

type Filter = "all" | "sent" | "pending" | "missing";
const filterMatches: Record<Filter, (status: ParticipantStatus) => boolean> = {
  all: () => true,
  sent: (status) => status === "accepted" || status === "revision",
  pending: (status) => status === "pending",
  missing: (status) => status === "not_started" || status === "overdue",
};

// Who did a task and who did not, with the mentor's actions next to each person.
export function TaskResultsSheet({ task, store, actorId, footer, onReview, onComplete, onClose }: {
  task: Task; store: Pick<Store, "users" | "submissions">; actorId?: string; footer?: ReactNode;
  onReview: (submission: Submission, status: "accepted" | "revision") => void; onComplete?: (task: Task, member: User) => void; onClose: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const results = taskParticipantResults(task, store);
  const progress = taskProgress(results);
  const shown = results.filter((result) => filterMatches[filter](result.status));
  const chips: Array<[Filter, string, number]> = [["all", "Все", progress.total], ["sent", "Сдали", progress.accepted + progress.revision], ["pending", "На проверке", progress.pending], ["missing", "Не сдали", progress.missing]];
  return <ModalSheet title={task.title} tall onClose={onClose} footer={footer}>
    <div className={styles.sheet}>
      <div className={styles.summary}>
        <p>{task.deadlineAt ? `Срок: ${formatDateTime(task.deadlineAt)}` : "Без срока"}</p>
        <strong>Ответили {progress.sent} из {progress.total}</strong>
        <i style={{ "--sent": `${progress.total ? (progress.accepted / progress.total) * 100 : 0}%`, "--waiting": `${progress.total ? ((progress.pending + progress.revision) / progress.total) * 100 : 0}%` } as CSSProperties} aria-hidden="true" />
        <span className={styles.legend}><b className={styles.accepted} />принято {progress.accepted}<b className={styles.waiting} />ждут решения или доработки {progress.pending + progress.revision}</span>
      </div>
      <div className={styles.chips} role="group" aria-label="Кого показать">
        {chips.map(([id, label, count]) => <button type="button" key={id} className={filter === id ? styles.active : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<b>{count}</b></button>)}
      </div>
      {shown.length === 0 ? <p className={styles.empty}>{results.length ? "В этой группе никого нет." : "В команде пока нет участников."}</p> : <ul className={styles.list}>
        {shown.map((result) => <li key={result.user.id}>
          <Avatar className={styles.avatar} name={result.user.name} src={result.user.avatarUrl} />
          <div className={styles.person}>
            <strong>{result.user.name}</strong>
            <span className={`${styles.status} ${styles[result.status]}`}>{participantStatusText(result.status)}{result.status === "accepted" && ` · +${formatMiles(result.submission?.points || 0)}`}</span>
            {result.submission?.comment && result.status === "revision" && <small>{result.submission.comment}</small>}
          </div>
          {result.submission && result.submission.source !== "interactive" && (result.status === "accepted" || result.status === "revision") &&
            <button type="button" className={`button ${result.status === "accepted" ? "button-danger" : "button-success"}`} onClick={() => onReview(result.submission as Submission, result.status === "accepted" ? "revision" : "accepted")}>{result.status === "accepted" ? "Вернуть" : "Принять"}</button>}
          {onComplete && task.isActive && !task.interactiveKind && result.user.id !== actorId && (result.status === "not_started" || result.status === "overdue") &&
            <button type="button" className="button button-success" onClick={() => onComplete(task, result.user)}>Засчитать</button>}
        </li>)}
      </ul>}
    </div>
  </ModalSheet>;
}
