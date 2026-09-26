"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveUpdates } from "@/frontend/shared/hooks/use-live-updates";
import { SectionBoundary } from "@/frontend/shared/SectionBoundary";
import { userScope } from "@/shared/domain/live-updates";
import type { FormEvent } from "react";
import { AuthScreen } from "@/frontend/features/auth/AuthScreen";
import { ApiError, authFetch, clearDevSession, createTelegramLink, deleteTaskAttachment, loadTelegramLinkStatus, refreshAuthSession, uploadTaskAttachment } from "@/frontend/shared/api/client";
import { createAdminTask, deleteAdminTask, reviewAdminSubmission, updateAdminTask } from "@/frontend/shared/api/admin-client";
import { reviewTeamJoinRequest } from "@/frontend/shared/api/team-client";
import { Toast } from "@/frontend/shared/Toast";
import { TelegramConnect } from "@/frontend/features/telegram/TelegramConnect";
import { AnnouncementsPanel } from "@/frontend/features/admin/AnnouncementsPanel";
import { StarsPanel } from "@/frontend/features/admin/StarsPanel";
import { ProgramsPanel } from "@/frontend/features/admin/ProgramsPanel";
import { NetworkPanel } from "@/frontend/features/admin/NetworkPanel";
import { WelcomeVideoSettingsPanel } from "@/frontend/features/admin/WelcomeVideoSettingsPanel";
import { WelcomeVideoGate } from "@/frontend/features/member/WelcomeVideoGate";
import { MobileDrawer } from "@/frontend/shared/MobileDrawer";
import { useMenuSwipe } from "@/frontend/shared/hooks/use-menu-swipe";
import type { AuthUser, Submission, Task, TaskAttachment, TeamJoinRequest } from "@/shared/domain/types";
import { TaskEditorModal, ReviewModal, DeleteModal } from "./AdminModals";
import type { TaskDraft, ReviewDraft } from "./AdminModals";
import { AccessDenied, Dashboard, TasksView, ReviewView, HistoryView, RequestsView } from "./AdminViews";

import type { AdminSection } from "./admin-sections";
import { useAdminData } from "./use-admin-data";
type AdminModal =
  | { type: "task"; task?: Task }
  | { type: "review"; submission: Submission; status: "accepted" | "revision" }
  | { type: "delete"; task: Task }
  | null;



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
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [toast, setToast] = useState("");
  const { store, setStore, requests, setRequests, programHistory, publicationHistory, ranking, counts, networkUsers, setNetworkUsers, dataError, dataLoading, refreshData } = useAdminData(authUser, section);
  const [modal, setModal] = useState<AdminModal>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({ title: "", description: "", resourceUrl: "", maxPoints: "10", hasDeadline: false, deadline: "" });
  const [taskAttachments, setTaskAttachments] = useState<TaskAttachment[]>([]);
  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>({ points: "0", comment: "" });
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const shellRef = useRef<HTMLElement>(null);
  const openMobileMenu = useCallback(() => setMobileMenuOpen(true), []);
  useMenuSwipe(shellRef, !authLoading && hasMentorAccess(authUser) && !mobileMenuOpen && !modal, openMobileMenu);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [section]);

  useEffect(() => {
    let cancelled = false;
    async function restoreAdmin() {
      try {
        const nextUser = await refreshAuthSession();
        if (cancelled) return;
        setAuthUser(nextUser);
        if (nextUser.role === "ceo") { window.location.href = "/ceo"; return; }
        if (!hasMentorAccess(nextUser)) return;
      } catch {
        if (!cancelled) setToast("Не удалось загрузить данные панели.");
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
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

  useLiveUpdates(authUser, async (topics) => {
    try {
      if (topics.includes("session") || topics.includes("resync")) {
        const currentUser = await refreshAuthSession();
        setAuthUser(currentUser);
        if (userScope(currentUser) !== userScope(authUser)) {
          setModal(null);
          setSection("dashboard");
          return;
        }
      }
      await refreshData();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { setAuthUser(null); setModal(null); }
    }
  });

  const pending = store.submissions.filter((submission) => submission.status === "pending");
  const pendingRequests = requests.filter((request) => request.status === "pending");

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
    setTaskAttachments(task?.attachments || []);
    setTaskFiles([]);
    setModal({ type: "task", task });
  }

  const openReviewModal = useCallback((submission: Submission, status: "accepted" | "revision") => {
    const task = store.tasks.find((item) => item.id === submission.taskId);
    setReviewDraft({
      points: String(submission.points || (status === "accepted" ? (task?.maxPoints ?? submission.taskMaxPoints ?? 0) : 0)),
      comment: submission.comment || "",
    });
    setModal({ type: "review", submission, status });
  }, [store.tasks]);

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
  }, [authUser, dataLoading, deepLinkHandled, store.submissions, openReviewModal]);
   function openDeleteModal(task: Task) {
    setModal({ type: "delete", task });
  }

  function closeModal() {
    if (!modalBusy) setModal(null);
  }

  async function submitReview() {
    if (!modal || modal.type !== "review") return;
    const task = store.tasks.find((item) => item.id === modal.submission.taskId);
    const maxPoints = task?.maxPoints ?? modal.submission.taskMaxPoints ?? 0;
    const parsedPoints = Number(reviewDraft.points);
    const points = Math.min(Math.max(Number.isFinite(parsedPoints) ? parsedPoints : 0, 0), maxPoints);
    setModalBusy(true);
    try {
      const updated = await reviewAdminSubmission(modal.submission.id, {
        status: modal.status,
        points,
        comment: reviewDraft.comment.trim(),
        expectedVersion: modal.submission.reviewVersion ?? 0,
      });
      setStore((current) => ({ ...current, submissions: current.submissions.map((item) => item.id === updated.id ? updated : item) }));
      await refreshData();
      setModal(null);
      setToast(modal.status === "accepted" ? "Работа принята, рейтинг обновлён." : "Работа возвращена на доработку.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Произошла ошибка при проверке.");
    } finally {
      setModalBusy(false);
    }
  }

  async function reviewRequest(teamRequest: TeamJoinRequest, status: "approved" | "rejected") {
    try {
      const updated = await reviewTeamJoinRequest(teamRequest.id, status);
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
      await refreshData();
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
      setToast("Максимум миль должен быть неотрицательным числом.");
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
      const taskRecord = modal.task
        ? await updateAdminTask(modal.task.id, { title, description, resourceUrl: taskDraft.resourceUrl.trim() || null, maxPoints, deadlineAt })
        : await createAdminTask({ title, description, resourceUrl: taskDraft.resourceUrl.trim() || null, maxPoints, deadlineAt });
      let saved: Task = { ...taskRecord, attachments: taskAttachments };
      for (let index = 0; index < taskFiles.length; index += 1) {
        try {
          const attachment = await uploadTaskAttachment(saved.id, taskFiles[index]);
          saved = { ...saved, attachments: [...(saved.attachments || []), attachment] };
          setTaskAttachments(saved.attachments || []);
        } catch (error) {
          const remaining = taskFiles.slice(index);
          setTaskFiles(remaining);
          setStore((current) => ({ ...current, tasks: modal.task ? current.tasks.map((item) => item.id === modal.task?.id ? saved : item) : [saved, ...current.tasks] }));
          setModal({ type: "task", task: saved });
          setToast(`Задание сохранено, но PDF «${taskFiles[index].name}» не загрузился. ${error instanceof Error ? error.message : "Повторите загрузку."}`);
          return;
        }
      }
      setStore((current) => ({ ...current, tasks: modal.task ? current.tasks.map((item) => item.id === modal.task?.id ? saved : item) : [saved, ...current.tasks] }));
      setTaskFiles([]);
      setModal(null);
      setToast("Задание сохранено.");
    } catch {
      setToast("Не удалось сохранить задание.");
    } finally {
      setModalBusy(false);
    }
  }

  async function removeTaskFile(attachment: TaskAttachment) {
    if (!modal || modal.type !== "task" || !modal.task) return;
    setModalBusy(true);
    try {
      const cleanupWarning = await deleteTaskAttachment(modal.task.id, attachment.id);
      const updatedAttachments = taskAttachments.filter((item) => item.id !== attachment.id);
      setTaskAttachments(updatedAttachments);
      setStore((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === modal.task?.id ? { ...item, attachments: updatedAttachments } : item) }));
      setModal({ type: "task", task: { ...modal.task, attachments: updatedAttachments } });
      if (cleanupWarning) setToast("Ссылка на PDF удалена, но файл не удалось очистить в закрытом хранилище.");
    } catch (error) { setToast(error instanceof Error ? error.message : "Не удалось удалить файл."); }
    finally { setModalBusy(false); }
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
      const cleanupWarning = await deleteAdminTask(modal.task.id);
      setStore((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== modal.task?.id), submissions: current.submissions.filter((submission) => submission.taskId !== modal.task?.id) }));
      setModal(null);
      setToast(cleanupWarning ? "Задание удалено, но его PDF не удалось очистить в закрытом хранилище." : "Задание удалено.");
    } catch {
      setToast("Не удалось удалить задание.");
    } finally {
      setModalBusy(false);
    }
  }

  function handleAuthenticated(nextUser: AuthUser) {
    setAuthUser(nextUser);
    if (nextUser.role === "ceo") window.location.href = "/ceo";
  }

  if (authLoading) return <div className="auth-loading">Загрузка профиля...</div>;
  if (!authUser) return <AuthScreen onAuthenticated={handleAuthenticated} initialMode="login" />;
  if (!hasMentorAccess(authUser)) return <AccessDenied onLogout={logout} />;

  const canPublishContent = authUser.role === "admin" || Boolean(authUser.canPublishTasks);
  const canReview = authUser.role === "admin" || Boolean(authUser.canReview);
  const sections: Array<[AdminSection, string, string]> = [
    ["dashboard", "Обзор", "⌂"], ["tasks", "Задания", "☷"], ["review", "Проверка работ", "✓"], ["history", "История", "◷"],
    ["announcements", "Объявления", "✦"], ["programs", "Программы", "▤"], ["welcome-video", "Приветственное видео", "▶"], ["stars", "Звёзды", "★"], ["network", "Структура сети", "⌘"],
  ];
  const visibleSections = sections.filter(([id]) => (id === "tasks" || id === "programs" || id === "announcements" || id === "welcome-video") ? canPublishContent : id === "review" || id === "history" || id === "stars" ? canReview : true);

  return <><main className="admin-shell" ref={shellRef}>
    <header className="admin-topbar"><button type="button" className="admin-mobile-menu-button" aria-label="Открыть меню" aria-expanded={mobileMenuOpen} aria-controls="mentor-mobile-menu" onClick={() => setMobileMenuOpen(true)}><span /><span /><span /></button><a className="brand" href="/"><img className="brand-logo" src="/brand/logo.svg" alt="Прокачка" /></a><div className="admin-top-actions"><a className="admin-back-link" href="/">← Обычный интерфейс</a><span className="admin-role">Наставник</span><TelegramConnect telegramId={authUser.telegramId} busy={telegramBusy} onLink={linkTelegram} onRefresh={checkTelegram} /><button className="logout-button" onClick={logout}>Выйти</button></div></header>
    <div className="admin-layout">
      <aside className="admin-sidebar"><p className="eyebrow">Управление</p><nav>
        {visibleSections.map(([id, label, icon]) => <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}><span>{icon}</span>{label}{id === "review" && counts.pending > 0 && <b>{counts.pending}</b>}</button>)}
        {authUser.role === "admin" && <button className={section === "requests" ? "active" : ""} onClick={() => setSection("requests")}><span>◈</span>Заявки{counts.requests > 0 && <b>{counts.requests}</b>}</button>}
      </nav></aside>
      <section className="admin-content"><div className="admin-heading"><div><p className="eyebrow">Панель наставника</p><h1>{section === "dashboard" ? `Добрый день, ${authUser.name || "наставник"}` : section === "tasks" ? "Задания" : section === "review" ? "Проверка работ" : section === "history" ? "История проверок" : section === "announcements" ? "Объявления" : section === "programs" ? "Программы" : section === "welcome-video" ? "Приветственное видео" : section === "stars" ? "Звёзды" : section === "network" ? "Структура сети" : "Заявки в команду"}</h1></div><div className="admin-heading-actions">{section === "tasks" && canPublishContent && <button className="primary-button" onClick={() => openTaskModal()}>+ Создать задание</button>}</div></div>
        <SectionBoundary loading={dataLoading} error={dataError} onRetry={() => void refreshData()}>
        {section === "dashboard" && <Dashboard store={store} pending={pending} ranking={ranking} onNavigate={setSection} />}
        {section === "tasks" && <TasksView store={store} actorId={authUser.id} canManageAll={authUser.role === "admin"} onToggle={toggleTask} onEdit={openTaskModal} onRemove={openDeleteModal} />}
        {section === "review" && <ReviewView store={store} submissions={pending} onReview={openReviewModal} />}
        {section === "history" && <HistoryView store={store} programs={programHistory} publications={publicationHistory} onReview={openReviewModal} />}{section === "programs" && <ProgramsPanel programs={store.programs} tasks={store.tasks} actorId={authUser.id} canManageAll={authUser.role === "admin"} onChange={(programs, tasks) => setStore((current) => ({ ...current, programs, tasks }))} onError={setToast} />}{section === "announcements" && <AnnouncementsPanel announcements={store.announcements} actorId={authUser.id} canManageAll={authUser.role === "admin"} onChange={(announcements) => setStore((current) => ({ ...current, announcements }))} onError={setToast} />}{section === "stars" && <StarsPanel actorId={authUser.id} users={store.users} awards={store.starAwards} onChange={(starAwards) => setStore((current) => ({ ...current, starAwards }))} onError={setToast} />}
        {section === "requests" && <RequestsView requests={pendingRequests} onReview={reviewRequest} />}
        {section === "network" && <NetworkPanel authUser={authUser} users={networkUsers} onChange={setNetworkUsers} onError={setToast} />}
        {section === "welcome-video" && canPublishContent && <WelcomeVideoSettingsPanel user={authUser} />}
        </SectionBoundary>
      </section>
    </div>
    <MobileDrawer open={mobileMenuOpen} onClose={closeMobileMenu}>
      <nav className="admin-mobile-drawer-nav">
        <a className="admin-mobile-drawer-home" href="/" onClick={() => setMobileMenuOpen(false)}>← Обычный интерфейс</a>
        {visibleSections.map(([id, label, icon]) => <button type="button" key={id} className={section === id ? "active" : ""} onClick={() => { setSection(id); setMobileMenuOpen(false); }}><span>{icon}</span>{label}{id === "review" && counts.pending > 0 && <b>{counts.pending}</b>}</button>)}
        {authUser.role === "admin" && <button type="button" className={section === "requests" ? "active" : ""} onClick={() => { setSection("requests"); setMobileMenuOpen(false); }}><span>◈</span>Заявки{counts.requests > 0 && <b>{counts.requests}</b>}</button>}
      </nav>
      <div className="admin-mobile-telegram"><TelegramConnect telegramId={authUser.telegramId} busy={telegramBusy} onLink={linkTelegram} onRefresh={checkTelegram} /></div>
    </MobileDrawer>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
    {modal?.type === "task" && <TaskEditorModal taskId={modal.task?.id} draft={taskDraft} editing={Boolean(modal.task)} busy={modalBusy} attachments={taskAttachments} files={taskFiles} onFilesChange={setTaskFiles} onRemoveAttachment={(attachment) => void removeTaskFile(attachment)} onChange={(key, value) => setTaskDraft((current) => ({ ...current, [key]: value }))} onClose={closeModal} onSubmit={saveTask} />}
    {modal?.type === "review" && <ReviewModal draft={reviewDraft} status={modal.status} maxPoints={store.tasks.find((task) => task.id === modal.submission.taskId)?.maxPoints ?? modal.submission.taskMaxPoints ?? 0} busy={modalBusy} onChange={(key, value) => setReviewDraft((current) => ({ ...current, [key]: value }))} onClose={closeModal} onSubmit={(event) => { event.preventDefault(); void submitReview(); }} />}
    {modal?.type === "delete" && <DeleteModal task={modal.task} busy={modalBusy} onClose={closeModal} onConfirm={() => { void confirmDeleteTask(); }} />}
  </main><WelcomeVideoGate user={authUser} /></>;
}

