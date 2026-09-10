"use client";

import { useEffect, useMemo, useState } from "react";
import { useAutoRefresh } from "@/frontend/shared/hooks/use-auto-refresh";
import type { FormEvent } from "react";
import { AuthScreen } from "@/frontend/features/auth/AuthScreen";
import { authFetch, clearDevSession, createTelegramLink, loadTelegramLinkStatus, refreshAuthSession } from "@/frontend/shared/api/client";
import { formatDate, formatDateTime } from "@/frontend/shared/lib/format";
import { createAdminTask, deleteAdminTask, loadAdminData, loadAdminProgramHistory, reviewAdminSubmission, updateAdminTask } from "@/frontend/shared/api/admin-client";
import { loadTeamRequests, reviewTeamJoinRequest } from "@/frontend/shared/api/team-client";
import { TelegramConnect } from "@/frontend/features/telegram/TelegramConnect";
import { AnnouncementsPanel } from "@/frontend/features/admin/AnnouncementsPanel";
import { StarsPanel } from "@/frontend/features/admin/StarsPanel";
import { ProgramsPanel } from "@/frontend/features/admin/ProgramsPanel";
import { NetworkPanel } from "@/frontend/features/admin/NetworkPanel";
import type { AuthUser, Store, Submission, SubmissionStatus, Task, TeamJoinRequest, User } from "@/shared/domain/types";
import type { ProgramHistory } from "@/frontend/shared/api/admin-client";

type AdminSection = "dashboard" | "tasks" | "programs" | "review" | "history" | "requests" | "announcements" | "stars" | "network";
type TaskDraft = { title: string; description: string; resourceUrl: string; maxPoints: string; hasDeadline: boolean; deadline: string };
type ReviewDraft = { points: string; comment: string };
type AdminModal =
  | { type: "task"; task?: Task }
  | { type: "review"; submission: Submission; status: "accepted" | "revision" }
  | { type: "delete"; task: Task }
  | null;

const statusText = (status: SubmissionStatus) => status === "pending" ? "На проверке" : status === "accepted" ? "Принято" : "На доработке";
const initials = (name: string) => name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

function isTaskExpired(task: Task) { return Boolean(task.deadlineAt && new Date(task.deadlineAt).getTime() <= Date.now()); }

function toLocalDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function hasMentorAccess(user?: AuthUser | null) {
  return Boolean(user && (user.role === "admin" || user.canReview || user.canPublishTasks));
}

export function AdminApp() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [store, setStore] = useState<Store>({ users: [], tasks: [], programs: [], programProgress: [], announcements: [], starAwards: [], submissions: [] });
  const [requests, setRequests] = useState<TeamJoinRequest[]>([]);
  const [programHistory, setProgramHistory] = useState<ProgramHistory[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<AdminModal>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({ title: "", description: "", resourceUrl: "", maxPoints: "10", hasDeadline: false, deadline: "" });
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>({ points: "0", comment: "" });
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function restoreAdmin() {
      try {
        const nextUser = await refreshAuthSession();
        setAuthUser(nextUser);
        if (nextUser.role === "ceo") { window.location.href = "/ceo"; return; }
        if (!hasMentorAccess(nextUser)) return;
        const [data, teamRequests, history] = await Promise.all([loadAdminData(), loadTeamRequests(), loadAdminProgramHistory()]);
        if (!cancelled) {
          setStore(data);
          setRequests(teamRequests);
      setProgramHistory(history);

        }
      } catch {
        if (!cancelled) setToast("Не удалось загрузить данные панели.");
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
          setDataLoading(false);
        }
      }
    }
    void restoreAdmin();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useAutoRefresh(async () => {
    if (!hasMentorAccess(authUser)) return;
    try {
      const currentUser = await refreshAuthSession();
      if (!hasMentorAccess(currentUser)) return;
      setAuthUser(currentUser);
      const [data, teamRequests, history] = await Promise.all([loadAdminData(), loadTeamRequests(), loadAdminProgramHistory()]);
      setStore(data);
      setRequests(teamRequests);
      setProgramHistory(history);

    } catch {
      // Фоновое обновление не должно прерывать работу наставника.
    }
  }, { enabled: hasMentorAccess(authUser) && !dataLoading, intervalMs: 15000 });

  const pending = store.submissions.filter((submission) => submission.status === "pending");
  const pendingRequests = requests.filter((request) => request.status === "pending");
  const ranking = useMemo(() => store.users.filter((user) => user.role === "member").map((user) => ({ ...user, points: store.submissions.filter((submission) => submission.userId === user.id && submission.status === "accepted").reduce((sum, submission) => sum + submission.points, 0) })).filter((user) => user.points > 0).sort((a, b) => b.points - a.points), [store]);

  async function logout() {
    clearDevSession();
    await authFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/";
  }

  async function linkTelegram() {
    if (!authUser) return;
    setTelegramBusy(true);
    try {
      const result = await createTelegramLink();
      if (result.linked) {
        setAuthUser({ ...authUser, telegramId: result.telegramId });
        setToast("Telegram уже привязан к этому аккаунту.");
      } else if (result.url) {
        window.location.assign(result.url);
      }
    } catch {
      setToast("Не удалось создать ссылку Telegram. Попробуйте ещё раз.");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function checkTelegram(silent = false) {
    if (!authUser) return;
    setTelegramBusy(true);
    try {
      const result = await loadTelegramLinkStatus();
      setAuthUser({ ...authUser, telegramId: result.telegramId });
      if (!silent) setToast(result.linked ? "Telegram привязан." : "Telegram пока не привязан.");
    } catch {
      setToast("Не удалось проверить привязку Telegram.");
    } finally {
      setTelegramBusy(false);
    }
  }

  function openTaskModal(task?: Task) {
    setTaskDraft({
      title: task?.title || "",
      description: task?.description || "",
      resourceUrl: task?.resourceUrl || "",
      maxPoints: String(task?.maxPoints || 10),
      hasDeadline: Boolean(task?.deadlineAt),
      deadline: toLocalDateTime(task?.deadlineAt),
    });
    setModal({ type: "task", task });
  }

  function openReviewModal(submission: Submission, status: "accepted" | "revision") {
    const task = store.tasks.find((item) => item.id === submission.taskId);
    setReviewDraft({
      points: String(submission.points || (status === "accepted" ? task?.maxPoints || 0 : 0)),
      comment: submission.comment || "",
    });
    setModal({ type: "review", submission, status });
  }

  useEffect(() => {
    if (dataLoading || !authUser || !hasMentorAccess(authUser) || deepLinkHandled) return;
    const submissionId = new URLSearchParams(window.location.search).get("submission");
    if (!submissionId) {
      setDeepLinkHandled(true);
      return;
    }
    const submission = store.submissions.find((item) => item.id === submissionId);
    if (!submission) return;
    setSection("review");
    openReviewModal(submission, "accepted");
    setDeepLinkHandled(true);
  }, [authUser, dataLoading, deepLinkHandled, store.submissions, store.tasks]);
   function openDeleteModal(task: Task) {
    setModal({ type: "delete", task });
  }

  function closeModal() {
    if (!modalBusy) setModal(null);
  }

  async function submitReview() {
    if (!modal || modal.type !== "review") return;
    const task = store.tasks.find((item) => item.id === modal.submission.taskId);
    const maxPoints = task?.maxPoints ?? 0;
    const parsedPoints = Number(reviewDraft.points);
    const points = Math.min(Math.max(Number.isFinite(parsedPoints) ? parsedPoints : 0, 0), maxPoints);
    setModalBusy(true);
    try {
      const updated = await reviewAdminSubmission(modal.submission.id, {
        status: modal.status,
        points,
        comment: reviewDraft.comment.trim(),
      });
      setStore((current) => ({ ...current, submissions: current.submissions.map((item) => item.id === updated.id ? updated : item) }));
      try { setProgramHistory(await loadAdminProgramHistory()); } catch { /* polling обновит историю позже */ }
      setModal(null);
      setToast(modal.status === "accepted" ? "Работа принята, рейтинг обновлён." : "Работа возвращена на доработку.");
    } catch {
      setToast("Произошла ошибка при проверке.");
    } finally {
      setModalBusy(false);
    }
  }

  async function reviewRequest(teamRequest: TeamJoinRequest, status: "approved" | "rejected") {
    try {
      const updated = await reviewTeamJoinRequest(teamRequest.id, status);
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
      try { setStore(await loadAdminData()); setProgramHistory(await loadAdminProgramHistory()); } catch { /* обновление списка участников не меняет результат заявки */ }
      setToast(status === "approved" ? "Участник принят в команду." : "Заявка отклонена.");
    } catch {
      setToast("Не удалось обработать заявку.");
    }
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || modal.type !== "task") return;
    const title = taskDraft.title.trim();
    const description = taskDraft.description.trim();
    const maxPoints = Number(taskDraft.maxPoints);
    if (title.length < 2) {
      setToast("Укажи название задания.");
      return;
    }
    if (description.length < 2) {
      setToast("Добавь описание задания.");
      return;
    }
    if (!Number.isFinite(maxPoints) || maxPoints < 0) {
      setToast("Максимум баллов должен быть неотрицательным числом.");
      return;
    }
    let deadlineAt: string | null = null;
    if (taskDraft.hasDeadline) {
      if (!taskDraft.deadline) {
        setToast("Выбери дату дедлайна или отключи его.");
        return;
      }
      const deadline = new Date(taskDraft.deadline);
      if (Number.isNaN(deadline.getTime())) {
        setToast("Дедлайн указан некорректно.");
        return;
      }
      deadlineAt = deadline.toISOString();
    }
    setModalBusy(true);
    try {
      const saved = modal.task
        ? await updateAdminTask(modal.task.id, { title, description, resourceUrl: taskDraft.resourceUrl.trim() || null, maxPoints, deadlineAt })
        : await createAdminTask({ title, description, resourceUrl: taskDraft.resourceUrl.trim() || null, maxPoints, deadlineAt });
      setStore((current) => ({ ...current, tasks: modal.task ? current.tasks.map((item) => item.id === modal.task?.id ? saved : item) : [saved, ...current.tasks] }));
      setModal(null);
      setToast("Задание сохранено.");
    } catch {
      setToast("Не удалось сохранить задание.");
    } finally {
      setModalBusy(false);
    }
  }

  async function toggleTask(id: string) {
    const task = store.tasks.find((item) => item.id === id);
    if (!task) return;
    try {
      const updated = await updateAdminTask(id, { isActive: !task.isActive });
      setStore((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === id ? updated : item) }));
      setToast(updated.isActive ? "Задание активировано." : "Задание скрыто.");
    } catch {
      setToast("Не удалось изменить статус задания.");
    }
  }

  async function confirmDeleteTask() {
    if (!modal || modal.type !== "delete") return;
    setModalBusy(true);
    try {
      await deleteAdminTask(modal.task.id);
      setStore((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== modal.task?.id), submissions: current.submissions.filter((submission) => submission.taskId !== modal.task?.id) }));
      setModal(null);
      setToast("Задание удалено.");
    } catch {
      setToast("Не удалось удалить задание.");
    } finally {
      setModalBusy(false);
    }
  }

  async function hydrateAdmin(nextUser: AuthUser) {
    setAuthUser(nextUser);
    if (nextUser.role === "ceo") { window.location.href = "/ceo"; return; }
    if (!hasMentorAccess(nextUser)) return;
    setDataLoading(true);
    try {
      const [data, teamRequests, history] = await Promise.all([loadAdminData(), loadTeamRequests(), loadAdminProgramHistory()]);
      setStore(data);
      setRequests(teamRequests);
      setProgramHistory(history);

    } catch {
      setToast("Не удалось загрузить данные панели.");
    } finally {
      setDataLoading(false);
    }
  }

  function handleAuthenticated(nextUser: AuthUser) {
    void hydrateAdmin(nextUser);
  }

  if (authLoading || dataLoading) return <div className="auth-loading">Загрузка профиля...</div>;
  if (!authUser) return <AuthScreen onAuthenticated={handleAuthenticated} initialMode="login" />;
  if (!hasMentorAccess(authUser)) return <AccessDenied onLogout={logout} />;

  const canPublishContent = authUser.role === "admin" || Boolean(authUser.canPublishTasks);
  const canReview = authUser.role === "admin" || Boolean(authUser.canReview);
  const sections: Array<[AdminSection, string, string]> = [
    ["dashboard", "Обзор", "⌂"], ["tasks", "Задания", "☷"], ["review", "Проверка работ", "✓"], ["history", "История", "◷"],
    ["announcements", "Объявления", "✦"], ["programs", "Программы", "▤"], ["stars", "Звёзды", "★"], ["network", "Структура сети", "⌘"],
  ];

  return <main className="admin-shell">
    <header className="admin-topbar"><a className="brand" href="/"><img className="brand-logo" src="/brand/logo.svg" alt="Прокачка" /></a><div className="admin-top-actions"><a className="admin-back-link" href="/">← Обычный интерфейс</a><span className="admin-role">Наставник</span><TelegramConnect telegramId={authUser.telegramId} busy={telegramBusy} onLink={linkTelegram} onRefresh={checkTelegram} /><button className="logout-button" onClick={logout}>Выйти</button></div></header>
    <div className="admin-layout">
      <aside className="admin-sidebar"><p className="eyebrow">Управление</p><nav>
        {sections.filter(([id]) => (id === "tasks" || id === "programs" || id === "announcements") ? canPublishContent : id === "review" || id === "history" || id === "stars" ? canReview : true).map(([id, label, icon]) => <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}><span>{icon}</span>{label}{id === "review" && pending.length > 0 && <b>{pending.length}</b>}</button>)}
        {authUser.role === "admin" && <button className={section === "requests" ? "active" : ""} onClick={() => setSection("requests")}><span>◈</span>Заявки{pendingRequests.length > 0 && <b>{pendingRequests.length}</b>}</button>}
      </nav></aside>
      <section className="admin-content"><div className="admin-heading"><div><p className="eyebrow">Панель наставника</p><h1>{section === "dashboard" ? `Добрый день, ${authUser.name || "наставник"}` : section === "tasks" ? "Задания" : section === "review" ? "Проверка работ" : section === "history" ? "История проверок" : section === "announcements" ? "Объявления" : section === "programs" ? "Программы" : section === "stars" ? "Звёзды" : section === "network" ? "Структура сети" : "Заявки в команду"}</h1></div><div className="admin-heading-actions">{section === "tasks" && canPublishContent && <button className="primary-button" onClick={() => openTaskModal()}>+ Создать задание</button>}{authUser.role === "admin" && section !== "requests" && <button className="text-button request-shortcut" onClick={() => setSection("requests")}>Заявки {pendingRequests.length > 0 && "(" + pendingRequests.length + ")"}</button>}</div></div>
        {section === "dashboard" && <Dashboard store={store} pending={pending} ranking={ranking} onNavigate={setSection} />}
        {section === "tasks" && <TasksView store={store} onToggle={toggleTask} onEdit={openTaskModal} onRemove={openDeleteModal} />}
        {section === "review" && <ReviewView store={store} submissions={pending} onReview={openReviewModal} />}
        {section === "history" && <HistoryView store={store} programs={programHistory} onReview={openReviewModal} />}{section === "programs" && <ProgramsPanel programs={store.programs} tasks={store.tasks} onChange={(programs, tasks) => setStore((current) => ({ ...current, programs, tasks }))} onError={setToast} />}{section === "announcements" && <AnnouncementsPanel announcements={store.announcements} onChange={(announcements) => setStore((current) => ({ ...current, announcements }))} onError={setToast} />}{section === "stars" && <StarsPanel actorId={authUser.id} users={store.users} awards={store.starAwards} onChange={(starAwards) => setStore((current) => ({ ...current, starAwards }))} onError={setToast} />}
        {section === "requests" && <RequestsView requests={pendingRequests} onReview={reviewRequest} />}
        {section === "network" && <NetworkPanel authUser={authUser} onError={setToast} />}
      </section>
    </div>
    {toast && <div className="toast">{toast}</div>}
    {modal?.type === "task" && <TaskEditorModal draft={taskDraft} editing={Boolean(modal.task)} busy={modalBusy} onChange={(key, value) => setTaskDraft((current) => ({ ...current, [key]: value }))} onClose={closeModal} onSubmit={saveTask} />}
    {modal?.type === "review" && <ReviewModal draft={reviewDraft} status={modal.status} maxPoints={store.tasks.find((task) => task.id === modal.submission.taskId)?.maxPoints ?? 0} busy={modalBusy} onChange={(key, value) => setReviewDraft((current) => ({ ...current, [key]: value }))} onClose={closeModal} onSubmit={(event) => { event.preventDefault(); void submitReview(); }} />}
    {modal?.type === "delete" && <DeleteModal task={modal.task} busy={modalBusy} onClose={closeModal} onConfirm={() => { void confirmDeleteTask(); }} />}
  </main>;
}

function TaskEditorModal({ draft, editing, busy, onChange, onClose, onSubmit }: { draft: TaskDraft; editing: boolean; busy: boolean; onChange: (key: keyof TaskDraft, value: string | boolean) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="editor-modal admin-form-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
    <p className="eyebrow">{editing ? "Редактирование" : "Новое задание"}</p>
    <h2>{editing ? "Изменить задание" : "Создать задание"}</h2>
    <label>Название задания<input value={draft.title} onChange={(event) => onChange("title", event.target.value)} placeholder="Например, записать короткое видео" autoFocus /></label>
    <label>Описание<textarea value={draft.description} onChange={(event) => onChange("description", event.target.value)} placeholder="Что нужно сделать участнику" rows={4} /></label>
    <label>Ссылка на материал <span className="field-hint">необязательно</span><input type="url" value={draft.resourceUrl} onChange={(event) => onChange("resourceUrl", event.target.value)} placeholder="https://youtube.com/..." /></label>
    <div className="form-two-columns">
      <label>Максимум баллов<input type="number" min="0" step="1" value={draft.maxPoints} onChange={(event) => onChange("maxPoints", event.target.value)} /></label>
      <label className="deadline-toggle"><span>Дедлайн</span><span className="switch-line"><input type="checkbox" checked={draft.hasDeadline} onChange={(event) => onChange("hasDeadline", event.target.checked)} /><span>{draft.hasDeadline ? "Установлен" : "Без дедлайна"}</span></span></label>
    </div>
    {draft.hasDeadline && <label>Дата и время дедлайна<input type="datetime-local" value={draft.deadline} onChange={(event) => onChange("deadline", event.target.value)} /></label>}
    <div className="modal-actions"><button type="button" className="button button-muted" onClick={onClose}>Отмена</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Сохраняем..." : editing ? "Сохранить изменения" : "Создать задание"}</button></div>
  </form></div>;
}

function ReviewModal({ draft, status, maxPoints, busy, onChange, onClose, onSubmit }: { draft: ReviewDraft; status: "accepted" | "revision"; maxPoints: number; busy: boolean; onChange: (key: keyof ReviewDraft, value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const accepting = status === "accepted";
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="editor-modal admin-form-modal review-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
    <p className={"eyebrow " + (accepting ? "eyebrow-success" : "eyebrow-warning")}>{accepting ? "Финальная проверка" : "Нужна доработка"}</p>
    <h2>{accepting ? "Принять работу?" : "Вернуть на доработку?"}</h2>
    <p className="modal-description">{accepting ? "Укажи результат проверки. Баллы автоматически попадут в рейтинг участника." : "Напиши понятный комментарий, чтобы участник знал, что исправить."}</p>
    <label>Баллы <span className="field-hint">максимум {maxPoints}</span><input type="number" min="0" max={maxPoints} step="1" value={draft.points} onChange={(event) => onChange("points", event.target.value)} /></label>
    <label>{accepting ? "Комментарий наставника" : "Что нужно доработать"}<textarea value={draft.comment} onChange={(event) => onChange("comment", event.target.value)} placeholder={accepting ? "Например, отличный разбор..." : "Например, подробнее раскрой второй пункт..."} rows={5} /></label>
    <div className="modal-actions"><button type="button" className="button button-muted" onClick={onClose}>Отмена</button><button type="submit" className={"button " + (accepting ? "button-success" : "button-warning")} disabled={busy}>{busy ? "Сохраняем..." : accepting ? "Принять работу" : "Вернуть на доработку"}</button></div>
  </form></div>;
}

function DeleteModal({ task, busy, onClose, onConfirm }: { task: Task; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="editor-modal admin-form-modal danger-modal" onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
    <p className="eyebrow eyebrow-danger">Опасное действие</p>
    <h2>Удалить задание?</h2>
    <p className="modal-description">«{task.title}» и вся история его отправок будут удалены. Это действие нельзя отменить.</p>
    <div className="modal-actions"><button type="button" className="button button-muted" onClick={onClose}>Отмена</button><button type="button" className="button button-danger" onClick={onConfirm} disabled={busy}>{busy ? "Удаляем..." : "Удалить задание"}</button></div>
  </div></div>;
}

function AccessDenied({ onLogout }: { onLogout: () => void }) { return <main className="admin-login"><div className="admin-login-card"><a className="brand" href="/"><img className="brand-logo" src="/brand/logo.svg" alt="Прокачка" /></a><p className="eyebrow">Доступ ограничен</p><h1>Это раздел наставника</h1><p>Твой аккаунт участника не может открыть админ-панель.</p><button className="primary-button full" onClick={() => { void onLogout(); }}>Выйти</button><a className="back-link" href="/">Вернуться к заданиям</a></div></main>; }
function Dashboard({ store, pending, ranking, onNavigate }: { store: Store; pending: Submission[]; ranking: { id: string; name: string; points: number }[]; onNavigate: (section: AdminSection) => void }) { return <><div className="metric-grid"><Metric label="Участники" value={store.users.length} note="в команде" icon="♙" /><Metric label="Активные задания" value={store.tasks.filter((task) => task.isActive && !isTaskExpired(task)).length} note={"из " + store.tasks.length + " всего"} icon="☷" /><Metric label="На проверке" value={pending.length} note="ждут внимания" icon="◷" /><Metric label="Принято работ" value={store.submissions.filter((submission) => submission.status === "accepted").length} note="за всё время" icon="✓" /></div><div className="dashboard-grid"><div className="admin-panel"><div className="panel-title"><div><p className="eyebrow">Сейчас</p><h2>Нужна проверка</h2></div><button className="text-button" onClick={() => onNavigate("review")}>Все работы →</button></div>{pending.length === 0 ? <EmptyAdmin text="Все работы проверены. Так держать!" /> : pending.slice(0, 3).map((submission) => <SubmissionRow key={submission.id} submission={submission} store={store} />)}</div><div className="admin-panel"><div className="panel-title"><div><p className="eyebrow">Команда</p><h2>Лидеры рейтинга</h2></div><button className="text-button" onClick={() => onNavigate("history")}>История →</button></div>{ranking.slice(0, 4).map((member, index) => <div className="leader-row" key={member.id}><span>{index + 1}</span><div className="rank-avatar">{initials(member.name)}</div><strong>{member.name}</strong><b>{member.points}</b></div>)}</div></div></>; }
function Metric({ label, value, note, icon }: { label: string; value: number; note: string; icon: string }) { return <div className="metric-card"><span className="metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>; }
function TaskKindSwitch({ value, onChange }: { value: "regular" | "programs"; onChange: (value: "regular" | "programs") => void }) {
  return <div className="task-kind-switch"><button className={value === "regular" ? "active" : ""} onClick={() => onChange("regular")}>Обычные задания</button><button className={value === "programs" ? "active" : ""} onClick={() => onChange("programs")}>Программы</button></div>;
}
function TasksView({ store, onToggle, onEdit, onRemove }: { store: Store; onToggle: (id: string) => void; onEdit: (task?: Task) => void; onRemove: (task: Task) => void }) {
  const [kind, setKind] = useState<"regular" | "programs">("regular");
  const tasks = [...store.tasks].filter((task) => kind === "programs" ? task.publicationType === "sequential" : task.publicationType !== "sequential").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <><TaskKindSwitch value={kind} onChange={setKind} /><div className="admin-panel table-panel">{tasks.length === 0 ? <EmptyAdmin text={kind === "programs" ? "Программ пока нет." : "Обычных заданий пока нет."} /> : tasks.map((task) => {
    const status = !task.isActive ? "inactive" : isTaskExpired(task) ? "expired" : "active";
    const taskMeta = task.publicationType === "sequential" ? "Программа · шаг " + (task.position || "") : task.deadlineAt ? "Дедлайн " + formatDateTime(task.deadlineAt) : "Без дедлайна";
    return <div className="task-admin-row" key={task.id}><div className="task-admin-main"><span className={"status-dot " + (status === "active" ? "active-dot" : status === "expired" ? "expired-dot" : "")} /><div><strong>{task.title}</strong><span>{formatDate(task.createdAt)} · {taskMeta} · {store.submissions.filter((submission) => submission.taskId === task.id).length} отправлений</span></div></div><span className={"admin-status " + status}>{status === "active" ? "Активно" : status === "expired" ? "Просрочено" : "Скрыто"}</span><span className="task-max">до {task.maxPoints} баллов</span><div className="row-actions"><button className="button button-edit" onClick={() => onEdit(task)}>Изменить</button><button className={"button " + (task.isActive ? "button-warning" : "button-success")} onClick={() => onToggle(task.id)}>{task.isActive ? "Скрыть" : "Активировать"}</button><button className="button button-danger" onClick={() => onRemove(task)}>Удалить</button></div></div>;
  })}</div></>;
}
function ReviewView({ store, submissions, onReview }: { store: Store; submissions: Submission[]; onReview: (submission: Submission, status: "accepted" | "revision") => void }) { return <div className="admin-panel table-panel">{submissions.length === 0 ? <EmptyAdmin text="Нет работ, ожидающих проверки." /> : submissions.map((submission) => <div className="review-row" key={submission.id}><SubmissionRow submission={submission} store={store} /><div className="review-actions"><a className="telegram-button" href="https://t.me" target="_blank" rel="noreferrer">Открыть в Telegram ↗</a><div><button className="button button-success" onClick={() => onReview(submission, "accepted")}>Принять</button><button className="button button-warning" onClick={() => onReview(submission, "revision")}>На доработку</button></div></div></div>)}</div>; }
function RequestsView({ requests, onReview }: { requests: TeamJoinRequest[]; onReview: (teamRequest: TeamJoinRequest, status: "approved" | "rejected") => void }) {
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

function HistoryView({ store, programs, onReview }: { store: Store; programs: ProgramHistory[]; onReview: (submission: Submission, status: "accepted" | "revision") => void }) {
  const [kind, setKind] = useState<"regular" | "programs">("regular");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [selectedStepPosition, setSelectedStepPosition] = useState(1);
  const tasks = [...store.tasks].filter((task) => task.publicationType !== "sequential").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const selectedResults = selectedTask ? taskParticipantResults(selectedTask, store) : [];
  const selectedProgram = programs.find((program) => program.id === selectedProgramId);
  return <>
    <TaskKindSwitch value={kind} onChange={setKind} />
    {kind === "regular" ? <div className="admin-panel table-panel history-task-list">{tasks.length === 0 ? <EmptyAdmin text="История обычных заданий пока пуста." /> : tasks.map((task) => {
      const results = taskParticipantResults(task, store);
      const completed = results.filter((result) => result.status === "accepted").length;
      const revisions = results.filter((result) => result.status === "revision").length;
      const overdue = results.filter((result) => result.status === "overdue").length;
      return <button type="button" className="history-task-row" key={task.id} onClick={() => setSelectedTaskId(task.id)}><div><strong>{task.title}</strong><span>{task.deadlineAt ? "Дедлайн " + formatDateTime(task.deadlineAt) : "Без дедлайна"}</span></div><div className="history-task-summary"><span className="summary-completed">{completed} выполнено</span><span className="summary-revision">{revisions} доработка</span><span className="summary-overdue">{overdue} просрочено</span></div><b>→</b></button>;
    })}</div> : <div className="program-history-list">{programs.length === 0 ? <div className="admin-panel"><EmptyAdmin text="История программ пока пуста." /></div> : programs.map((program) => {
      const counts = program.members.reduce((result, member) => { result[member.status] = (result[member.status] || 0) + 1; return result; }, {} as Record<string, number>);
      return <button type="button" className="program-history-row" key={program.id} onClick={() => { setSelectedProgramId(program.id); setSelectedStepPosition(1); }}><div className="program-history-main"><span className={"program-history-dot " + (program.isActive ? "active" : "muted")} /><div><strong>{program.title}</strong><span>{program.steps.length} шагов · {program.deadlineHours} ч на каждый шаг · опубликовано {formatDate(program.createdAt)}</span></div></div><div className="program-history-summary"><span className="summary-completed">{counts.on_time || 0} успели</span><span className="summary-active">{counts.active || 0} ещё успевают</span><span className="summary-warning">{counts.late || 0} с опозданием</span><span className="summary-overdue">{counts.missed || 0} пропустили</span><span className="summary-completed">{counts.completed || 0} завершили</span></div><b>→</b></button>;
    })}</div>}
    {selectedTask && kind === "regular" && <div className="modal-backdrop" onMouseDown={() => setSelectedTaskId(null)}><div className="task-history-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSelectedTaskId(null)} aria-label="Закрыть">×</button><p className="eyebrow">История задания</p><h2>{selectedTask.title}</h2><p className="task-history-deadline">{selectedTask.deadlineAt ? "Дедлайн: " + formatDateTime(selectedTask.deadlineAt) : "Задание без дедлайна"}</p><div className="task-report-list">{selectedResults.length === 0 ? <EmptyAdmin text="В команде пока нет участников." /> : selectedResults.map((result) => <div className="task-report-row" key={result.user.id}><div className="rank-avatar">{initials(result.user.name)}</div><div className="task-report-main"><strong>{result.user.name}</strong>{result.submission?.comment && result.status === "revision" && <small>{result.submission.comment}</small>}</div><div className={"task-report-status " + result.status}><span>{participantStatusText(result.status)}</span>{result.status === "accepted" && <b>+{result.submission?.points || 0}</b>}{result.submission && (result.status === "accepted" || result.status === "revision") && <button className={"button " + (result.status === "accepted" ? "button-danger" : "button-success")} onClick={(event) => { event.stopPropagation(); onReview(result.submission as Submission, result.status === "accepted" ? "revision" : "accepted"); }}>{result.status === "accepted" ? "Вернуть" : "Принять"}</button>}</div></div>)}</div></div></div>}
    {selectedProgram && kind === "programs" && (() => {
      const selectedStep = selectedProgram.steps.find((step) => step.position === selectedStepPosition) || selectedProgram.steps[0];
      const members = selectedStep?.members || [];
      const counts = members.reduce((result, member) => { result[member.status] = (result[member.status] || 0) + 1; return result; }, {} as Record<string, number>);
      return <div className="modal-backdrop" onMouseDown={() => setSelectedProgramId(null)}><div className="task-history-modal program-history-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSelectedProgramId(null)} aria-label="Закрыть">×</button><p className="eyebrow">История программы</p><h2>{selectedProgram.title}</h2><p className="task-history-deadline">{selectedProgram.steps.length} шагов · у каждого шага свой персональный дедлайн {selectedProgram.deadlineHours} ч</p><div className="program-step-list">{selectedProgram.steps.map((step) => { const stepCounts = step.members.reduce((result, member) => { result[member.status] = (result[member.status] || 0) + 1; return result; }, {} as Record<string, number>); return <button type="button" className={"program-step-chip " + (selectedStep?.id === step.id ? "selected" : "")} key={step.id} onClick={() => setSelectedStepPosition(step.position)}><b>Шаг {step.position}</b><span>{step.title}</span><small>{step.deadlineHours} ч · до {step.maxPoints} баллов</small><em>{stepCounts.on_time || 0} успели · {stepCounts.active || 0} срок идёт · {stepCounts.late || 0} поздно · {stepCounts.missed || 0} пропустили · {stepCounts.locked || 0} не открыт</em></button>; })}</div><div className="program-member-list"><div className="program-step-heading"><strong>Участники: {selectedStep ? "шаг " + selectedStep.position : "—"}</strong><span>{counts.on_time || 0} успели · {counts.active || 0} срок идёт · {counts.late || 0} поздно · {counts.missed || 0} пропустили</span></div>{members.length === 0 ? <EmptyAdmin text="В команде пока нет участников." /> : members.map((member) => <div className="program-member-row" key={member.userId}><div className="rank-avatar">{initials(member.name)}</div><div className="program-member-main"><strong>{member.name}</strong><span>{member.status === "locked" ? "Откроется после выполнения предыдущего шага" : member.dueAt ? "Дедлайн шага до " + formatDateTime(member.dueAt) : "Статус шага"}</span></div><div className={"program-member-status " + programHistoryStatusClass(member.status)}><b>{programHistoryStatusText(member.status)}</b>{member.dueAt && member.status !== "locked" && <small>Срок до {formatDateTime(member.dueAt)}</small>}{member.submittedAt && <small>Отправлено {formatDateTime(member.submittedAt)}</small>}</div></div>)}</div></div></div>;
    })()}  </>;
}
function SubmissionRow({ submission, store }: { submission: Submission; store: Store }) {
  const user = store.users.find((item) => item.id === submission.userId);
  const task = store.tasks.find((item) => item.id === submission.taskId);
  const answerLabel = submission.mediaType === "photo" ? "Фото" : submission.mediaType === "video" ? "Видео" : submission.mediaType === "document" ? "Файл" : submission.mediaType === "text" ? "Текст" : "Ответ";
  return <div className="submission-row submission-row-with-answer">
    <div className="rank-avatar">{user ? initials(user.name) : "?"}</div>
    <div className="submission-row-copy">
      <strong>{user?.name || "Неизвестный участник"}</strong>
      <span>{task?.title || "Удалённое задание"}</span>
      {submission.answerText && <p className="submission-answer-text">{submission.answerText}</p>}
      {submission.mediaType && submission.mediaType !== "text" && <details className="submission-media-details">
        <summary>Показать ответ: {answerLabel}</summary>
        {submission.mediaType === "photo" && <img className="submission-media-preview" src={`/api/submissions/${submission.id}/media`} alt="Ответ участника" />}
        {submission.mediaType === "video" && <video className="submission-media-preview" src={`/api/submissions/${submission.id}/media`} controls preload="metadata" />}
        {submission.mediaType === "document" && <a className="submission-file-link" href={`/api/submissions/${submission.id}/media`} target="_blank" rel="noreferrer">Открыть файл ответа ↗</a>}
      </details>}
    </div>
    <time>{formatDateTime(submission.submittedAt)}</time>
  </div>;
}
function EmptyAdmin({ text }: { text: string }) { return <div className="empty-admin"><span>✓</span><p>{text}</p></div>; }

