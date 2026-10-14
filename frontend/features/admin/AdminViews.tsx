"use client";
import { useState } from "react";
import { Avatar } from "@/frontend/shared/Avatar";
import type { Store, Submission, Task, User } from "@/shared/domain/types";
import type { ProgramHistory, PublicationHistoryItem } from "@/shared/domain/history";
import { formatDate, formatDateTime, formatMiles } from "@/frontend/shared/lib/format";
import { SubmissionCard } from "./SubmissionCard";
import { plural, waitingInfo } from "./review-queue";
import { taskParticipantResults } from "./task-results";
import { TaskResultsSheet } from "./TaskResultsSheet";

export function AccessDenied({ onLogout }: { onLogout: () => void }) { return <main className="admin-login"><div className="admin-login-card"><a className="brand" href="/"><img className="brand-logo" src="/brand/logo.svg" alt="Прокачка" /></a><p className="eyebrow">Доступ ограничен</p><h1>Это раздел наставника</h1><p>Твой аккаунт участника не может открыть админ-панель.</p><button className="primary-button full" onClick={() => { void onLogout(); }}>Выйти</button><a className="back-link" href="/">Вернуться к заданиям</a></div></main>; }
function HistoryKindSwitch({ value, onChange }: { value: "regular" | "programs" | "publications"; onChange: (value: "regular" | "programs" | "publications") => void }) {
  return <div className="task-kind-switch history-kind-switch"><button type="button" className={value === "regular" ? "active" : ""} onClick={() => onChange("regular")}>Задания</button><button type="button" className={value === "programs" ? "active" : ""} onClick={() => onChange("programs")}>Программы</button><button type="button" className={value === "publications" ? "active" : ""} onClick={() => onChange("publications")}>Публикации</button></div>;
}
// The mentor task list lives in its own file; this module keeps exporting it for the panel.
export { TasksView } from "./AdminTasksView";

export function ReviewView({ store, submissions, onReview, onStart, onEditTemplates }: { store: Store; submissions: Submission[]; onReview: (submission: Submission, status: "accepted" | "revision") => void; onStart: () => void; onEditTemplates?: () => void }) {
  const oldest = submissions[0] ? waitingInfo(submissions[0].submittedAt) : null;
  return <div className="submission-review-list">
    {submissions.length > 0 && <div className="review-queue-bar"><div><strong>{submissions.length} {plural(submissions.length, "работа ждёт", "работы ждут", "работ ждут")} проверки</strong>{oldest && <small>Сверху самые старые · первая {oldest.text}</small>}</div>
      <div className="review-queue-actions">{onEditTemplates && <button type="button" className="button button-edit" onClick={onEditTemplates}>Готовые комментарии</button>}<button type="button" className="button button-primary" onClick={onStart}>Проверять по очереди</button></div></div>}
    {submissions.length === 0 ? <div className="admin-panel"><EmptyAdmin text="Нет работ, ожидающих проверки." /></div> : submissions.map((submission) =>
      <SubmissionCard key={submission.id} submission={submission} name={store.users.find((user) => user.id === submission.userId)?.name || "Неизвестный участник"} avatarUrl={store.users.find((user) => user.id === submission.userId)?.avatarUrl} taskTitle={submission.taskTitle || store.tasks.find((task) => task.id === submission.taskId)?.title || "Удалённое задание"} onReview={onReview} />
    )}</div>;
}
function programHistoryStatusText(status: ProgramHistory["members"][number]["status"]) {
  if (status === "on_time") return "Успел в срок";
  if (status === "active") return "Срок ещё идёт";
  if (status === "late") return "Отправил с опозданием";
  if (status === "missed") return "Не отправил — просрочено";
  if (status === "locked") return "Шаг ещё не открыт";
  return "Программа завершена";
}

function programHistoryStatusClass(status: ProgramHistory["members"][number]["status"]) {
  return status === "on_time" || status === "completed" ? "success" : status === "active" ? "active" : status === "late" ? "warning" : status === "locked" ? "muted" : "danger";
}

function stepCountLabel(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  const suffix = lastTwo >= 11 && lastTwo <= 14 ? "шагов" : last === 1 ? "шаг" : last >= 2 && last <= 4 ? "шага" : "шагов";
  return `${count} ${suffix}`;
}

function PublicationHistoryList({ items }: { items: PublicationHistoryItem[] }) {
  const typeLabel = (type: PublicationHistoryItem["type"]) => type === "task" ? "Задание" : type === "program" ? "Программа" : "Объявление";
  return <div className="publication-history-list">{items.length === 0 ? <div className="admin-panel"><EmptyAdmin text="История публикаций пока пуста." /></div> : items.map((item) => <div className="publication-history-row" key={item.type + ":" + item.id}><div className="publication-history-icon">{item.type === "announcement" ? "!" : item.type === "program" ? "↗" : "✓"}</div><div className="publication-history-copy"><strong>{item.title}</strong><span>{typeLabel(item.type)} · опубликовал: <b>{item.authorName}</b> · {formatDateTime(item.createdAt)}</span></div><span className={"admin-status " + (item.isActive ? "active" : "inactive")}>{item.isActive ? "Активно" : "Скрыто"}</span></div>)}</div>;
}

export function HistoryView({ store, programs, publications, onReview, actorId, onComplete, canNudge, onNotice }: { store: Store; programs: ProgramHistory[]; publications: PublicationHistoryItem[]; onReview: (submission: Submission, status: "accepted" | "revision") => void; actorId?: string; onComplete?: (task: Task, member: User) => void; canNudge?: boolean; onNotice?: (message: string) => void }) {
  const [kind, setKind] = useState<"regular" | "programs" | "publications">("regular");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [selectedStepPosition, setSelectedStepPosition] = useState(1);
  const publicationTaskIds = new Set(publications.filter((item) => item.type === "task").map((item) => item.id));
  const publicationProgramIds = new Set(publications.filter((item) => item.type === "program").map((item) => item.id));
  const tasks = [...store.tasks].filter((task) => task.publicationType !== "sequential" && publicationTaskIds.has(task.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visiblePrograms = programs.filter((program) => publicationProgramIds.has(program.id) && program.steps.length > 0);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const selectedProgram = visiblePrograms.find((program) => program.id === selectedProgramId);
  return <>
    <HistoryKindSwitch value={kind} onChange={setKind} />
    {kind === "publications" ? <PublicationHistoryList items={publications} /> : kind === "regular" ? <div className="history-task-list">{tasks.length === 0 ? <div className="admin-panel"><EmptyAdmin text="История обычных заданий пока пуста." /></div> : tasks.map((task) => {
      const results = taskParticipantResults(task, store);
      const completed = results.filter((result) => result.status === "accepted").length;
      const revisions = results.filter((result) => result.status === "revision").length;
      const overdue = results.filter((result) => result.status === "overdue").length;
      return <button type="button" className="history-task-row" key={task.id} onClick={() => setSelectedTaskId(task.id)}><div className="history-task-main"><span className={"history-task-dot " + (task.isActive ? "active" : "muted")} aria-hidden="true" /><div><strong>{task.title}</strong><span>{task.deadlineAt ? "Дедлайн " + formatDateTime(task.deadlineAt) : "Без дедлайна"}</span></div></div><div className="history-task-summary"><span className="summary-completed">{completed} выполнено</span><span className="summary-revision">{revisions} доработка</span><span className="summary-overdue">{overdue} просрочено</span></div><b aria-hidden="true">→</b></button>;
    })}</div> : <div className="program-history-list">{visiblePrograms.length === 0 ? <div className="admin-panel"><EmptyAdmin text="История программ пока пуста." /></div> : visiblePrograms.map((program) => {
      const counts = program.members.reduce((result, member) => { result[member.status] = (result[member.status] || 0) + 1; return result; }, {} as Record<string, number>);
      return <button type="button" className="program-history-row" key={program.id} onClick={() => { setSelectedProgramId(program.id); setSelectedStepPosition(1); }}><div className="program-history-main"><span className={"program-history-dot " + (program.isActive ? "active" : "muted")} /><div><strong>{program.title}</strong><span>{stepCountLabel(program.steps.length)} · {program.deadlineHours} ч на шаг · опубликовано {formatDate(program.createdAt)}</span></div></div><div className="program-history-summary"><span className="summary-completed">{counts.on_time || 0} успели</span><span className="summary-active">{counts.active || 0} ещё успевают</span><span className="summary-warning">{counts.late || 0} с опозданием</span><span className="summary-overdue">{counts.missed || 0} пропустили</span><span className="summary-completed">{counts.completed || 0} завершили</span></div><b>→</b></button>;
    })}</div>}
    {selectedTask && kind === "regular" && <TaskResultsSheet task={selectedTask} store={store} actorId={actorId} canNudge={canNudge} onNotice={onNotice} onReview={onReview} onComplete={onComplete} onClose={() => setSelectedTaskId(null)} />}
    {selectedProgram && kind === "programs" && (() => {
      const selectedStep = selectedProgram.steps.find((step) => step.position === selectedStepPosition) || selectedProgram.steps[0];
      const members = selectedStep?.members || [];
      const counts = members.reduce((result, member) => { result[member.status] = (result[member.status] || 0) + 1; return result; }, {} as Record<string, number>);
      return <div className="modal-backdrop history-modal-backdrop" onMouseDown={() => setSelectedProgramId(null)}>
        <div className="task-history-modal program-history-modal" role="dialog" aria-modal="true" aria-labelledby="program-history-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="history-modal-header">
            <div className="history-modal-heading">
              <p className="eyebrow">История программы</p>
              <h2 id="program-history-title">{selectedProgram.title}</h2>
              <p className="task-history-deadline">{stepCountLabel(selectedProgram.steps.length)} · на каждый шаг — {selectedProgram.deadlineHours} ч с момента открытия</p>
            </div>
            <button type="button" className="modal-close" onClick={() => setSelectedProgramId(null)} aria-label="Закрыть">×</button>
          </div>
          <div className="history-modal-body">
            <div className="program-step-list">{selectedProgram.steps.map((step) => { const stepCounts = step.members.reduce((result, member) => { result[member.status] = (result[member.status] || 0) + 1; return result; }, {} as Record<string, number>); return <button type="button" className={"program-step-chip " + (selectedStep?.id === step.id ? "selected" : "")} key={step.id} onClick={() => setSelectedStepPosition(step.position)}><b>Шаг {step.position}</b><span>{step.title}</span><small>{step.deadlineHours} ч · до {formatMiles(step.maxPoints)}</small><em>{stepCounts.on_time || 0} успели · {stepCounts.active || 0} срок идёт · {stepCounts.late || 0} поздно · {stepCounts.missed || 0} пропустили · {stepCounts.locked || 0} не открыт</em></button>; })}</div>
            <div className="program-member-list"><div className="program-step-heading"><strong>Участники: {selectedStep ? "шаг " + selectedStep.position : "—"}</strong><span>{counts.on_time || 0} успели · {counts.active || 0} срок идёт · {counts.late || 0} поздно · {counts.missed || 0} пропустили</span></div>{members.length === 0 ? <EmptyAdmin text="В команде пока нет участников." /> : members.map((member) => <div className="program-member-row" key={member.userId}><Avatar className="rank-avatar" name={member.name} src={member.avatarUrl} /><div className="program-member-main"><strong>{member.name}</strong><span>{member.status === "locked" ? "Откроется после выполнения предыдущего шага" : member.dueAt ? "Дедлайн шага до " + formatDateTime(member.dueAt) : "Статус шага"}</span></div><div className={"program-member-status " + programHistoryStatusClass(member.status)}><b>{programHistoryStatusText(member.status)}</b>{member.dueAt && member.status !== "locked" && <small>Срок до {formatDateTime(member.dueAt)}</small>}{member.submittedAt && <small>Отправлено {formatDateTime(member.submittedAt)}</small>}</div></div>)}</div>
          </div>
        </div>
      </div>;
    })()}  </>;
}
function EmptyAdmin({ text }: { text: string }) { return <div className="empty-admin"><span>✓</span><p>{text}</p></div>; }
