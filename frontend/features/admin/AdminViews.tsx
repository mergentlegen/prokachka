"use client";
import { useState } from "react";
import type { Store, Submission, Task, TeamJoinRequest, User } from "@/shared/domain/types";
import type { ProgramHistory, PublicationHistoryItem } from "@/shared/domain/history";
import type { AdminSection } from "./admin-sections";
import { formatDate, formatDateTime, formatMiles } from "@/frontend/shared/lib/format";
import { SubmissionCard, SubmissionSummary } from "./SubmissionCard";
const initials = (name: string) => name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
function isTaskExpired(task: Task) { return Boolean(task.deadlineAt && new Date(task.deadlineAt).getTime() <= Date.now()); }

export function AccessDenied({ onLogout }: { onLogout: () => void }) { return <main className="admin-login"><div className="admin-login-card"><a className="brand" href="/"><img className="brand-logo" src="/brand/logo.svg" alt="Прокачка" /></a><p className="eyebrow">Доступ ограничен</p><h1>Это раздел наставника</h1><p>Твой аккаунт участника не может открыть админ-панель.</p><button className="primary-button full" onClick={() => { void onLogout(); }}>Выйти</button><a className="back-link" href="/">Вернуться к заданиям</a></div></main>; }
export function Dashboard({ store, pending, ranking, onNavigate }: { store: Store; pending: Submission[]; ranking: { id: string; name: string; points: number }[]; onNavigate: (section: AdminSection) => void }) { return <><div className="metric-grid"><Metric label="Участники" value={store.users.length} note="в команде" icon="♙" /><Metric label="Активные задания" value={store.tasks.filter((task) => task.isActive && !isTaskExpired(task)).length} note={"из " + store.tasks.length + " всего"} icon="☷" /><Metric label="На проверке" value={pending.length} note="ждут внимания" icon="◷" /><Metric label="Принято работ" value={store.submissions.filter((submission) => submission.status === "accepted").length} note="за всё время" icon="✓" /></div><div className="dashboard-grid"><div className="admin-panel"><div className="panel-title"><div><p className="eyebrow">Сейчас</p><h2>Нужна проверка</h2></div><button className="text-button" onClick={() => onNavigate("review")}>Все работы →</button></div>{pending.length === 0 ? <EmptyAdmin text="Все работы проверены." /> : pending.slice(0, 3).map((submission) => <SubmissionRow key={submission.id} submission={submission} store={store} />)}</div><div className="admin-panel"><div className="panel-title"><div><p className="eyebrow">Команда</p><h2>Лидеры рейтинга</h2></div><button className="text-button" onClick={() => onNavigate("history")}>История →</button></div>{ranking.slice(0, 4).map((member, index) => <div className="leader-row" key={member.id}><span>{index + 1}</span><div className="rank-avatar">{initials(member.name)}</div><strong>{member.name}</strong><b>{member.points}</b></div>)}</div></div></>; }
function Metric({ label, value, note, icon }: { label: string; value: number; note: string; icon: string }) { return <div className="metric-card"><span className="metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>; }
function TaskKindSwitch({ value, onChange }: { value: "regular" | "programs"; onChange: (value: "regular" | "programs") => void }) {
  return <div className="task-kind-switch"><button className={value === "regular" ? "active" : ""} onClick={() => onChange("regular")}>Задания</button><button className={value === "programs" ? "active" : ""} onClick={() => onChange("programs")}>Программы</button></div>;
}
function HistoryKindSwitch({ value, onChange }: { value: "regular" | "programs" | "publications"; onChange: (value: "regular" | "programs" | "publications") => void }) {
  return <div className="task-kind-switch"><button className={value === "regular" ? "active" : ""} onClick={() => onChange("regular")}>Задания</button><button className={value === "programs" ? "active" : ""} onClick={() => onChange("programs")}>Программы</button><button className={value === "publications" ? "active" : ""} onClick={() => onChange("publications")}>Публикации</button></div>;
}
export function TasksView({ store, actorId, canManageAll, onToggle, onEdit, onRemove }: { store: Store; actorId: string; canManageAll: boolean; onToggle: (id: string) => void; onEdit: (task?: Task) => void; onRemove: (task: Task) => void }) {
  const [kind, setKind] = useState<"regular" | "programs">("regular");
  const tasks = [...store.tasks].filter((task) => kind === "programs" ? task.publicationType === "sequential" : task.publicationType !== "sequential").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <><TaskKindSwitch value={kind} onChange={setKind} /><div className="admin-panel table-panel">{tasks.length === 0 ? <EmptyAdmin text={kind === "programs" ? "Программ пока нет." : "Обычных заданий пока нет."} /> : tasks.map((task) => {
    const status = !task.isActive ? "inactive" : isTaskExpired(task) ? "expired" : "active";
    const taskMeta = task.publicationType === "sequential" ? "Программа · шаг " + (task.position || "") : task.deadlineAt ? "Дедлайн " + formatDateTime(task.deadlineAt) : "Без дедлайна";
    const canManage = canManageAll || task.publisherId === actorId;
    return <div className="task-admin-row" key={task.id}><div className="task-admin-main"><span className={"status-dot " + (status === "active" ? "active-dot" : status === "expired" ? "expired-dot" : "")} /><div><strong>{task.title}</strong><span>{formatDate(task.createdAt)} · {taskMeta} · {store.submissions.filter((submission) => submission.taskId === task.id).length} отправлений</span></div></div><span className={"admin-status " + status}>{status === "active" ? "Активно" : status === "expired" ? "Просрочено" : "Скрыто"}</span><span className="task-max">до {formatMiles(task.maxPoints)}</span>{canManage && <div className="row-actions"><button className="button button-edit" onClick={() => onEdit(task)}>Изменить</button><button className={"button " + (task.isActive ? "button-warning" : "button-success")} onClick={() => onToggle(task.id)}>{task.isActive ? "Скрыть" : "Активировать"}</button><button className="button button-danger" onClick={() => onRemove(task)}>Удалить</button></div>}</div>;
  })}</div></>;
}
export function ReviewView({ store, submissions, onReview }: { store: Store; submissions: Submission[]; onReview: (submission: Submission, status: "accepted" | "revision") => void }) {
  return <div className="submission-review-list">{submissions.length === 0 ? <div className="admin-panel"><EmptyAdmin text="Нет работ, ожидающих проверки." /></div> : submissions.map((submission) =>
    <SubmissionCard key={submission.id} submission={submission} name={store.users.find((user) => user.id === submission.userId)?.name || "Неизвестный участник"} taskTitle={submission.taskTitle || store.tasks.find((task) => task.id === submission.taskId)?.title || "Удалённое задание"} onReview={onReview} />
  )}</div>;
}
export function RequestsView({ requests, onReview }: { requests: TeamJoinRequest[]; onReview: (teamRequest: TeamJoinRequest, status: "approved" | "rejected") => void }) {
  return <div className="admin-panel table-panel">{requests.length === 0 ? <EmptyAdmin text="Новых заявок в команду нет." /> : requests.map((teamRequest) => <div className="review-row" key={teamRequest.id}><div className="submission-row"><div className="rank-avatar">{initials(teamRequest.userName || "У")}</div><div><strong>{teamRequest.userName || "Новый участник"}</strong><span>Заявка на вступление в команду</span></div><time>{formatDateTime(teamRequest.createdAt)}</time></div><div className="review-actions"><span className="request-team-name">{teamRequest.teamName || "Твоя команда"}</span><div><button className="button button-success" onClick={() => onReview(teamRequest, "approved")}>Принять</button><button className="button button-danger" onClick={() => onReview(teamRequest, "rejected")}>Отклонить</button></div></div></div>)}</div>;
}
type ParticipantResult = { user: User; status: "accepted" | "revision" | "pending" | "overdue" | "not_started"; submission?: Submission };

function taskParticipantResults(task: Task, store: Store): ParticipantResult[] {
  const latestByUser = new Map<string, Submission>();
  store.submissions.filter((submission) => submission.taskId === task.id).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)).forEach((submission) => latestByUser.set(submission.userId, submission));
  const expired = Boolean(task.deadlineAt && new Date(task.deadlineAt).getTime() <= Date.now());
  return store.users.filter((user) => user.role === "member").map((user) => {
    const submission = latestByUser.get(user.id);
    return { user, submission, status: submission?.status || (expired ? "overdue" : "not_started") };
  });
}

function participantStatusText(status: ParticipantResult["status"]) {
  if (status === "accepted") return "Выполнено";
  if (status === "revision") return "На доработке";
  if (status === "pending") return "На проверке";
  if (status === "overdue") return "Просрочил";
  return "Не отправил";
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

function PublicationHistoryList({ items }: { items: PublicationHistoryItem[] }) {
  const typeLabel = (type: PublicationHistoryItem["type"]) => type === "task" ? "Задание" : type === "program" ? "Программа" : "Объявление";
  return <div className="admin-panel table-panel publication-history-list">{items.length === 0 ? <EmptyAdmin text="История публикаций пока пуста." /> : items.map((item) => <div className="publication-history-row" key={item.type + ":" + item.id}><div className="publication-history-icon">{item.type === "announcement" ? "!" : item.type === "program" ? "↗" : "✓"}</div><div className="publication-history-copy"><strong>{item.title}</strong><span>{typeLabel(item.type)} · опубликовал: <b>{item.authorName}</b> · {formatDateTime(item.createdAt)}</span></div><span className={"admin-status " + (item.isActive ? "active" : "inactive")}>{item.isActive ? "Активно" : "Скрыто"}</span></div>)}</div>;
}

export function HistoryView({ store, programs, publications, onReview }: { store: Store; programs: ProgramHistory[]; publications: PublicationHistoryItem[]; onReview: (submission: Submission, status: "accepted" | "revision") => void }) {
  const [kind, setKind] = useState<"regular" | "programs" | "publications">("regular");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [selectedStepPosition, setSelectedStepPosition] = useState(1);
  const publicationTaskIds = new Set(publications.filter((item) => item.type === "task").map((item) => item.id));
  const publicationProgramIds = new Set(publications.filter((item) => item.type === "program").map((item) => item.id));
  const tasks = [...store.tasks].filter((task) => task.publicationType !== "sequential" && publicationTaskIds.has(task.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visiblePrograms = programs.filter((program) => publicationProgramIds.has(program.id));
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const selectedResults = selectedTask ? taskParticipantResults(selectedTask, store) : [];
  const selectedProgram = visiblePrograms.find((program) => program.id === selectedProgramId);
  return <>
    <HistoryKindSwitch value={kind} onChange={setKind} />
    {kind === "publications" ? <PublicationHistoryList items={publications} /> : kind === "regular" ? <div className="admin-panel table-panel history-task-list">{tasks.length === 0 ? <EmptyAdmin text="История обычных заданий пока пуста." /> : tasks.map((task) => {
      const results = taskParticipantResults(task, store);
      const completed = results.filter((result) => result.status === "accepted").length;
      const revisions = results.filter((result) => result.status === "revision").length;
      const overdue = results.filter((result) => result.status === "overdue").length;
      return <button type="button" className="history-task-row" key={task.id} onClick={() => setSelectedTaskId(task.id)}><div><strong>{task.title}</strong><span>{task.deadlineAt ? "Дедлайн " + formatDateTime(task.deadlineAt) : "Без дедлайна"}</span></div><div className="history-task-summary"><span className="summary-completed">{completed} выполнено</span><span className="summary-revision">{revisions} доработка</span><span className="summary-overdue">{overdue} просрочено</span></div><b>→</b></button>;
    })}</div> : <div className="program-history-list">{visiblePrograms.length === 0 ? <div className="admin-panel"><EmptyAdmin text="История программ пока пуста." /></div> : visiblePrograms.map((program) => {
      const counts = program.members.reduce((result, member) => { result[member.status] = (result[member.status] || 0) + 1; return result; }, {} as Record<string, number>);
      return <button type="button" className="program-history-row" key={program.id} onClick={() => { setSelectedProgramId(program.id); setSelectedStepPosition(1); }}><div className="program-history-main"><span className={"program-history-dot " + (program.isActive ? "active" : "muted")} /><div><strong>{program.title}</strong><span>{program.steps.length} шагов · {program.deadlineHours} ч на каждый шаг · опубликовано {formatDate(program.createdAt)}</span></div></div><div className="program-history-summary"><span className="summary-completed">{counts.on_time || 0} успели</span><span className="summary-active">{counts.active || 0} ещё успевают</span><span className="summary-warning">{counts.late || 0} с опозданием</span><span className="summary-overdue">{counts.missed || 0} пропустили</span><span className="summary-completed">{counts.completed || 0} завершили</span></div><b>→</b></button>;
    })}</div>}
    {selectedTask && kind === "regular" && <div className="modal-backdrop" onMouseDown={() => setSelectedTaskId(null)}><div className="task-history-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSelectedTaskId(null)} aria-label="Закрыть">×</button><p className="eyebrow">История задания</p><h2>{selectedTask.title}</h2><p className="task-history-deadline">{selectedTask.deadlineAt ? "Дедлайн: " + formatDateTime(selectedTask.deadlineAt) : "Задание без дедлайна"}</p><div className="task-report-list">{selectedResults.length === 0 ? <EmptyAdmin text="В команде пока нет участников." /> : selectedResults.map((result) => <div className="task-report-row" key={result.user.id}><div className="rank-avatar">{initials(result.user.name)}</div><div className="task-report-main"><strong>{result.user.name}</strong>{result.submission?.comment && result.status === "revision" && <small>{result.submission.comment}</small>}</div><div className={"task-report-status " + result.status}><span>{participantStatusText(result.status)}</span>{result.status === "accepted" && <b>+{formatMiles(result.submission?.points || 0)}</b>}{result.submission && result.submission.source !== "interactive" && (result.status === "accepted" || result.status === "revision") && <button className={"button " + (result.status === "accepted" ? "button-danger" : "button-success")} onClick={(event) => { event.stopPropagation(); onReview(result.submission as Submission, result.status === "accepted" ? "revision" : "accepted"); }}>{result.status === "accepted" ? "Вернуть" : "Принять"}</button>}</div></div>)}</div></div></div>}
    {selectedProgram && kind === "programs" && (() => {
      const selectedStep = selectedProgram.steps.find((step) => step.position === selectedStepPosition) || selectedProgram.steps[0];
      const members = selectedStep?.members || [];
      const counts = members.reduce((result, member) => { result[member.status] = (result[member.status] || 0) + 1; return result; }, {} as Record<string, number>);
      return <div className="modal-backdrop" onMouseDown={() => setSelectedProgramId(null)}><div className="task-history-modal program-history-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSelectedProgramId(null)} aria-label="Закрыть">×</button><p className="eyebrow">История программы</p><h2>{selectedProgram.title}</h2><p className="task-history-deadline">{selectedProgram.steps.length} шагов · у каждого шага свой персональный дедлайн {selectedProgram.deadlineHours} ч</p><div className="program-step-list">{selectedProgram.steps.map((step) => { const stepCounts = step.members.reduce((result, member) => { result[member.status] = (result[member.status] || 0) + 1; return result; }, {} as Record<string, number>); return <button type="button" className={"program-step-chip " + (selectedStep?.id === step.id ? "selected" : "")} key={step.id} onClick={() => setSelectedStepPosition(step.position)}><b>Шаг {step.position}</b><span>{step.title}</span><small>{step.deadlineHours} ч · до {formatMiles(step.maxPoints)}</small><em>{stepCounts.on_time || 0} успели · {stepCounts.active || 0} срок идёт · {stepCounts.late || 0} поздно · {stepCounts.missed || 0} пропустили · {stepCounts.locked || 0} не открыт</em></button>; })}</div><div className="program-member-list"><div className="program-step-heading"><strong>Участники: {selectedStep ? "шаг " + selectedStep.position : "—"}</strong><span>{counts.on_time || 0} успели · {counts.active || 0} срок идёт · {counts.late || 0} поздно · {counts.missed || 0} пропустили</span></div>{members.length === 0 ? <EmptyAdmin text="В команде пока нет участников." /> : members.map((member) => <div className="program-member-row" key={member.userId}><div className="rank-avatar">{initials(member.name)}</div><div className="program-member-main"><strong>{member.name}</strong><span>{member.status === "locked" ? "Откроется после выполнения предыдущего шага" : member.dueAt ? "Дедлайн шага до " + formatDateTime(member.dueAt) : "Статус шага"}</span></div><div className={"program-member-status " + programHistoryStatusClass(member.status)}><b>{programHistoryStatusText(member.status)}</b>{member.dueAt && member.status !== "locked" && <small>Срок до {formatDateTime(member.dueAt)}</small>}{member.submittedAt && <small>Отправлено {formatDateTime(member.submittedAt)}</small>}</div></div>)}</div></div></div>;
    })()}  </>;
}
function SubmissionRow({ submission, store }: { submission: Submission; store: Store }) {
  const user = store.users.find((item) => item.id === submission.userId);
  const task = store.tasks.find((item) => item.id === submission.taskId);
  return <SubmissionSummary submission={submission} name={user?.name || "Неизвестный участник"} taskTitle={submission.taskTitle || task?.title || "Удалённое задание"} />;
}
function EmptyAdmin({ text }: { text: string }) { return <div className="empty-admin"><span>✓</span><p>{text}</p></div>; }
