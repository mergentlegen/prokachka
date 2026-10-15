"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Store, Submission, Task, User } from "@/shared/domain/types";
import { compareTaskFeed } from "@/shared/domain/task-feed-order";
import { formatDate, formatMiles } from "@/frontend/shared/lib/format";
import { deadlineInfo } from "@/frontend/features/member/member-progress";
import { actionIcons } from "./AdminIcons";
import { taskParticipantResults, taskProgress } from "./task-results";
import styles from "./AdminTasksView.module.css";

type TaskState = "running" | "expired" | "hidden";
const stateLabels: Record<TaskState, string> = { running: "Идёт", expired: "Срок истёк", hidden: "Скрыто" };
const toneClass = { calm: styles.toneCalm, soon: styles.toneSoon, urgent: styles.toneUrgent, past: styles.toneMuted, none: styles.toneMuted };

export function taskState(task: Task, now = Date.now()): TaskState {
  if (!task.isActive) return "hidden";
  return task.deadlineAt && Date.parse(task.deadlineAt) <= now ? "expired" : "running";
}

/** "осталось 2 дня", "срок истёк 13 окт.", "без срока" — and how urgent it looks. */
export function deadlineLine(task: Task, now = Date.now()): { text: string; tone: "calm" | "soon" | "urgent" | "past" | "none" } {
  if (!task.deadlineAt) return { text: "без срока", tone: "none" };
  if (Date.parse(task.deadlineAt) <= now) return { text: "срок истёк " + formatDate(task.deadlineAt), tone: "past" };
  const info = deadlineInfo(task.deadlineAt, now);
  return info ? { text: info.text, tone: info.tone === "expired" ? "past" : info.tone } : { text: "", tone: "none" };
}

export type MenuItem = { label: string; icon: ReactNode; danger?: boolean; onSelect: () => void };

// "⋯": the rarer actions of a task, so the card keeps one visible button.
export function ActionsMenu({ title, items, disabled }: { title: string; items: MenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className={styles.menuBox} ref={box}>
    <button ref={toggle} type="button" className={styles.more} aria-haspopup="menu" aria-expanded={open} aria-label={`Ещё действия: ${title}`} disabled={disabled} onClick={() => setOpen(!open)}>
      <span aria-hidden="true">⋯</span>
    </button>
    {open && <div className={styles.menu} role="menu">
      {items.map((item) => <button key={item.label} type="button" role="menuitem" className={item.danger ? styles.danger : ""} onClick={() => { setOpen(false); item.onSelect(); }}>{item.icon}{item.label}</button>)}
    </div>}
  </div>;
}

export const pinIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5-4 1-3 5 1 3-3-1-5 3 1-4-5-5 4 1 5-3 1-4Z" /><path d="m8 16-5 5" /></svg>;

type CardProps = {
  task: Task; users: User[]; submissions: Submission[]; now: number; canManage: boolean; busy: boolean;
  onOpenResults?: (task: Task) => void; onReview?: (task: Task) => void;
  onToggle: (id: string) => void; onEdit: (task: Task) => void; onRemove: (task: Task) => void; onPin?: (task: Task) => void;
};

function TaskCard({ task, users, submissions, now, canManage, busy, onOpenResults, onReview, onToggle, onEdit, onRemove, onPin }: CardProps) {
  const state = taskState(task, now);
  const deadline = deadlineLine(task, now);
  const progress = taskProgress(taskParticipantResults(task, { users, submissions }));
  const items: MenuItem[] = [
    ...(onPin ? [{ label: task.isPinned ? "Открепить" : "Закрепить сверху", icon: pinIcon, onSelect: () => onPin(task) }] : []),
    { label: task.isActive ? "Скрыть от участников" : "Показать участникам", icon: task.isActive ? actionIcons.hide : actionIcons.show, onSelect: () => onToggle(task.id) },
    { label: "Удалить", icon: actionIcons.remove, danger: true, onSelect: () => onRemove(task) },
  ];
  return <article className={`${styles.card} ${state === "running" ? "" : styles.past}`}>
    <div className={styles.top}>
      <span className={`${styles.state} ${styles[state]}`}>{stateLabels[state]}</span>
      {task.isPinned && <span className={styles.pinned}>{pinIcon}Закреплено</span>}
      {canManage && <div className={styles.actions}>
        <button type="button" className={styles.edit} disabled={busy} onClick={() => onEdit(task)}>{actionIcons.edit}Изменить</button>
        <ActionsMenu title={task.title} items={items} disabled={busy} />
      </div>}
    </div>
    <h3 className={styles.title}>{task.title}</h3>
    <p className={styles.meta}>до {formatMiles(task.maxPoints)} · <span className={toneClass[deadline.tone]}>{deadline.text}</span></p>
    {progress.total > 0 && <div className={styles.progress}>
      <button type="button" className={styles.results} onClick={() => onOpenResults?.(task)} disabled={!onOpenResults} aria-label={`Кто сдал задание «${task.title}»`}>
        <span className={styles.resultsLine}><b>Ответили {progress.sent} из {progress.total}</b>{progress.pending > 0 && <em>{progress.pending} на проверке</em>}<i aria-hidden="true">→</i></span>
        <span className={styles.bar} aria-hidden="true"><span style={{ width: `${(progress.accepted / progress.total) * 100}%` }} /><span className={styles.waiting} style={{ width: `${((progress.pending + progress.revision) / progress.total) * 100}%` }} /></span>
      </button>
      {progress.pending > 0 && onReview && <button type="button" className={styles.review} onClick={() => onReview(task)}>Проверить</button>}
    </div>}
  </article>;
}

type Props = Omit<CardProps, "task" | "users" | "submissions" | "now" | "canManage" | "busy"> & { store: Store; actorId: string; canManageAll: boolean; busyId?: string };

// Mentor's tasks: what is running now on top, finished and hidden ones folded below; ready games live in their catalog.
export function TasksView({ store, actorId, canManageAll, busyId, ...actions }: Props) {
  const [query, setQuery] = useState("");
  const [pastOpen, setPastOpen] = useState(false);
  const [now] = useState(() => Date.now());
  const readyProgramIds = new Set(store.programs.filter((program) => program.templateKey).map((program) => program.id));
  const tasks = store.tasks.filter((task) => !task.interactiveKind && !readyProgramIds.has(task.programId || "") && task.publicationType !== "sequential").sort(compareTaskFeed);
  const search = query.trim().toLocaleLowerCase("ru");
  const found = search ? tasks.filter((task) => task.title.toLocaleLowerCase("ru").includes(search)) : tasks;
  const running = found.filter((task) => taskState(task, now) === "running");
  const past = found.filter((task) => taskState(task, now) !== "running");
  const showPast = pastOpen || (Boolean(search) && past.length > 0);
  const card = (task: Task) => <TaskCard key={task.id} task={task} users={store.users || []} submissions={store.submissions || []} now={now} busy={Boolean(busyId)}
    canManage={canManageAll || task.publisherId === actorId} {...actions} />;
  if (!tasks.length) return <div className="admin-panel"><div className="empty-admin"><p>Заданий пока нет.</p></div></div>;
  return <div className={styles.view}>
    <label className="admin-search"><span className="sr-label">Поиск задания</span><input id="admin-task-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти задание по названию" /></label>
    {search && !found.length ? <div className="admin-panel"><div className="empty-admin"><p>Ничего не нашлось. Попробуйте другое слово.</p></div></div> : <>
      <section className={styles.group} aria-label="Сейчас идут">
        <h2 className={styles.groupTitle}>Сейчас идут <span>{running.length}</span></h2>
        {running.length ? <div className={styles.list}>{running.map(card)}</div> : <p className={styles.empty}>{search ? "Среди идущих заданий совпадений нет." : "Сейчас нет идущих заданий. Создайте новое или покажите скрытое."}</p>}
      </section>
      {past.length > 0 && <section className={styles.group} aria-label="Завершённые и скрытые">
        <button type="button" className={styles.fold} aria-expanded={showPast} onClick={() => setPastOpen(!showPast)}>
          Завершённые и скрытые <span>{past.length}</span><i aria-hidden="true" />
        </button>
        {showPast && <div className={styles.list}>{past.map(card)}</div>}
      </section>}
    </>}
  </div>;
}
