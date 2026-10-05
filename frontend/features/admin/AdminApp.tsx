"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveUpdates } from "@/frontend/shared/hooks/use-live-updates";
import { SectionBoundary } from "@/frontend/shared/SectionBoundary";
import { userScope } from "@/shared/domain/live-updates";
import type { FormEvent } from "react";
import { AuthScreen } from "@/frontend/features/auth/AuthScreen";
import { ApiError, authFetch, clearDevSession, createTelegramLink, deleteTaskAttachment, loadTelegramLinkStatus, refreshAuthSession, request, uploadTaskAttachment } from "@/frontend/shared/api/client";
import { createAdminTask, deleteAdminTask, recordMentorCompletion, reviewAdminSubmission, updateAdminTask } from "@/frontend/shared/api/admin-client";
import { reviewTeamJoinRequest } from "@/frontend/shared/api/team-client";
import { Avatar } from "@/frontend/shared/Avatar";
import { ProfileDialog } from "@/frontend/features/profile/ProfileDialog";
import { Toast } from "@/frontend/shared/Toast";
import { TelegramConnect } from "@/frontend/features/telegram/TelegramConnect";
import { AnnouncementsPanel } from "@/frontend/features/admin/AnnouncementsPanel";
import { StarsPanel } from "@/frontend/features/admin/StarsPanel";
import { ProgramsPanel } from "@/frontend/features/admin/ProgramsPanel";
import { ProgramEditorModal } from "./ProgramEditorModal";
import { ReadyProgramsPanel } from "./ReadyProgramsPanel";
import { TaskOrderDialog } from "./TaskOrderDialog";
import { NetworkPanel } from "@/frontend/features/admin/NetworkPanel";
import { WelcomeVideoSettingsPanel } from "@/frontend/features/admin/WelcomeVideoSettingsPanel";
import { FeedbackPanel } from "@/frontend/features/feedback/FeedbackPanel";
import { WelcomeVideoGate } from "@/frontend/features/member/WelcomeVideoGate";
import { MobileDrawer } from "@/frontend/shared/MobileDrawer";
import { useMenuSwipe } from "@/frontend/shared/hooks/use-menu-swipe";
import type { AuthUser, Submission, Task, TaskAttachment, TeamJoinRequest, User } from "@/shared/domain/types";
import { validMiles } from "@/shared/domain/miles";
import { TaskEditorModal, ReviewModal, DeleteModal, CompletionModal } from "./AdminModals";
import type { TaskDraft, ReviewDraft } from "./AdminModals";
import { AccessDenied, TasksView, ReviewView, HistoryView } from "./AdminViews";
import { RequestsPanel } from "./RequestsPanel";
import { AdminDashboard } from "./AdminDashboard";
import { DEFAULT_REVIEW_TEMPLATES, ReviewFlow, type ReviewDecision } from "./ReviewFlow";
import { ReviewTemplatesEditor } from "./ReviewTemplatesEditor";
import { adminIcons, homeIcon, logoutIcon, profileIcon } from "./AdminIcons";
import { reviewQueue } from "./review-queue";
import { loadReviewTemplates, saveReviewTemplates } from "@/frontend/shared/api/review-templates-client";
import { PullToRefresh } from "@/frontend/shared/PullToRefresh";
import { TaskResultsSheet } from "./TaskResultsSheet";
import { removeTaskVideo, uploadTaskVideo } from "@/frontend/shared/api/task-video-client";

import type { AdminSection } from "./admin-sections";
import { useAdminData } from "./use-admin-data";
type AdminModal =
  | { type: "task"; task?: Task }
  | { type: "review"; submission: Submission; status: "accepted" | "revision" }
  | { type: "delete"; task: Task }
  | { type: "complete"; task: Task; member: User }
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
  const [feedbackVersion, setFeedbackVersion] = useState(0);
  const [feedbackNeedsReply, setFeedbackNeedsReply] = useState(0);
  const [toast, setToast] = useState("");
  const { store, setStore, requests, setRequests, programHistory, publicationHistory, counts, networkUsers, setNetworkUsers, dataError, dataLoading, refreshData } = useAdminData(authUser, section);
  const [modal, setModal] = useState<AdminModal>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [programEditorOpen, setProgramEditorOpen] = useState(false);
  const [taskOrderOpen, setTaskOrderOpen] = useState(false);
  const [taskActionBusy, setTaskActionBusy] = useState("");
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({ title: "", description: "", resourceUrl: "", maxPoints: "10", hasDeadline: false, deadline: "" });
  const [taskAttachments, setTaskAttachments] = useState<TaskAttachment[]>([]);
  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  const [taskVideoFile, setTaskVideoFile] = useState<File | null>(null);
  const [taskVideoRemoving, setTaskVideoRemoving] = useState(false);
  const [modalBusyLabel, setModalBusyLabel] = useState<string | undefined>(undefined);
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>({ points: "0", comment: "" });
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [reviewFlow, setReviewFlow] = useState<{ startId: string; intent?: "accepted" | "revision"; single?: boolean } | null>(null);
  const [templates, setTemplates] = useState<{ list: string[]; canEdit: boolean }>({ list: [], canEdit: false });
  const [templatesEditorOpen, setTemplatesEditorOpen] = useState(false);
  const [resultsTaskId, setResultsTaskId] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const shellRef = useRef<HTMLElement>(null);
  const openMobileMenu = useCallback(() => setMobileMenuOpen(true), []);
  useMenuSwipe(shellRef, !authLoading && hasMentorAccess(authUser) && !mobileMenuOpen && !modal && !taskOrderOpen, openMobileMenu);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [section]);

  useEffect(() => {
    if (!authUser || !(authUser.role === "admin" || authUser.canReview) || !new URLSearchParams(window.location?.search || "").has("feedback")) return;
    const timer = window.setTimeout(() => setSection("feedback"), 0);
    return () => window.clearTimeout(timer);
  }, [authUser]);

  useEffect(() => {
    if (!authUser || !(authUser.role === "admin" || authUser.canReview)) return;
    let active = true;
    void request<{ counts: { needsReply: number } }>("/api/feedback?scope=mentor&summary=1", { cache: "no-store" })
      .then(({ counts }) => { if (active) setFeedbackNeedsReply(counts.needsReply || 0); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [authUser?.id, authUser?.role, authUser?.canReview, feedbackVersion]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Reloads the shared comments when the reviewer, their rights or their team change.
  const templatesViewer = authUser && authUser.teamId && (authUser.role === "admin" || authUser.canReview) ? `${authUser.id}:${authUser.role}:${authUser.teamId}` : "";
  useEffect(() => {
    if (!templatesViewer) return;
    let active = true;
    void loadReviewTemplates().then((result) => { if (active) setTemplates({ list: result.templates, canEdit: result.canEdit }); }).catch(() => undefined);
    return () => { active = false; };
  }, [templatesViewer]);

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
      if (topics.includes("feedback") || topics.includes("resync")) setFeedbackVersion((value) => value + 1);
      if (topics.includes("session") || topics.includes("resync")) {
        const currentUser = await refreshAuthSession();
        setAuthUser(currentUser);
        if (userScope(currentUser) !== userScope(authUser)) {
          setModal(null);
          setTaskOrderOpen(false);
          setSection("dashboard");
          return;
        }
      }
      await refreshData();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { setAuthUser(null); setModal(null); }
    }
  });

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
    setTaskVideoFile(null);
    setTaskVideoRemoving(false);
    setModal({ type: "task", task });
  }

  const openCompletionModal = useCallback((task: Task, member: User) => {
    setReviewDraft({ points: String(task.maxPoints), comment: "" });
    setModal({ type: "complete", task, member });
  }, []);

  async function submitCompletion() {
    if (!modal || modal.type !== "complete") return;
    const parsedPoints = Number(reviewDraft.points);
    const points = Math.min(Math.max(Number.isFinite(parsedPoints) ? Math.round(parsedPoints) : 0, 0), modal.task.maxPoints);
    setModalBusy(true);
    try {
      const saved = await recordMentorCompletion({ taskId: modal.task.id, memberId: modal.member.id, points, comment: reviewDraft.comment.trim() });
      setStore((current) => ({ ...current, submissions: [saved, ...current.submissions.filter((item) => item.id !== saved.id)] }));
      await refreshData();
      setModal(null);
      setToast(`Выполнение засчитано: ${modal.member.name}. Участник получит обратную связь.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось засчитать выполнение.");
    } finally {
      setModalBusy(false);
    }
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
    if (submission.status === "pending") setReviewFlow({ startId: submission.id });
    else openReviewModal(submission, "accepted");
    setDeepLinkHandled(true);
  }, [authUser, dataLoading, deepLinkHandled, store.submissions, openReviewModal]);
   function openDeleteModal(task: Task) {
    setModal({ type: "delete", task });
  }

  function closeModal() {
    if (!modalBusy) setModal(null);
  }

  // Opens one participant's work from a conversation: the answer and the decision in the review window.
  function openSubmission(submissionId: string) {
    if (store.submissions.some((item) => item.id === submissionId)) setReviewFlow({ startId: submissionId, single: true });
    else setToast("Работа не найдена: возможно, её удалили вместе с заданием.");
  }

  async function saveDecision(submission: Submission, decision: ReviewDecision) {
    try {
      const updated = await reviewAdminSubmission(submission.id, { ...decision, expectedVersion: submission.reviewVersion ?? 0 });
      setStore((current) => ({ ...current, submissions: current.submissions.map((item) => item.id === updated.id ? updated : item) }));
      void refreshData();
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Произошла ошибка при проверке.");
      return false;
    }
  }

  async function storeTemplates(list: string[]) {
    try {
      const result = await saveReviewTemplates(list);
      setTemplates({ list: result.templates, canEdit: true });
      setToast("Готовые комментарии сохранены.");
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось сохранить готовые комментарии.");
      return false;
    }
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
      void refreshData();
      setToast(status === "approved" ? "Участник принят в команду." : "Заявка отклонена.");
      return true;
    } catch {
      setToast("Не удалось обработать заявку.");
      return false;
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
    if (!validMiles(maxPoints)) {
      setToast("Укажите целое неотрицательное количество миль.");
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
      let saved: Task = { ...taskRecord, attachments: taskAttachments, video: modal.task?.video };
      for (let index = 0; index < taskFiles.length; index += 1) {
        try {
          const attachment = await uploadTaskAttachment(saved.id, taskFiles[index]);
          saved = { ...saved, attachments: [...(saved.attachments || []), attachment] };
          setTaskAttachments(saved.attachments || []);
        } catch (error) {
          const remaining = taskFiles.slice(index);
          setTaskFiles(remaining);
          setStore((current) => ({ ...current, tasks: modal.task ? current.tasks.map((item) => item.id === modal.task?.id ? { ...saved, feedOrder: item.feedOrder } : item) : [...current.tasks.filter((item) => item.id !== saved.id), saved] }));
          setModal({ type: "task", task: saved });
          setToast(`Задание сохранено, но PDF «${taskFiles[index].name}» не загрузился. ${error instanceof Error ? error.message : "Повторите загрузку."}`);
          return;
        }
      }
      // The task itself is saved first; a video problem never loses the text the mentor typed.
      let videoNotice = "";
      if (taskVideoRemoving && !taskVideoFile && saved.video) {
        try { await removeTaskVideo(saved.id); saved = { ...saved, video: undefined }; }
        catch { videoNotice = " Видео удалить не удалось, попробуйте ещё раз."; }
      }
      if (taskVideoFile) {
        try {
          setModalBusyLabel("Загружаем видео… 0%");
          await uploadTaskVideo(saved.id, taskVideoFile, (percentage) => setModalBusyLabel(`Загружаем видео… ${percentage}%`));
          saved = { ...saved, video: { status: "processing", playable: Boolean(saved.video?.playable), durationSeconds: saved.video?.durationSeconds } };
          videoNotice = " Видео загружено и сжимается — у участников появится через несколько минут.";
        } catch (error) {
          setStore((current) => ({ ...current, tasks: modal.task ? current.tasks.map((item) => item.id === modal.task?.id ? { ...saved, feedOrder: item.feedOrder } : item) : [...current.tasks.filter((item) => item.id !== saved.id), saved] }));
          setTaskFiles([]);
          setModal({ type: "task", task: saved });
          setToast(`Задание сохранено, но видео не загрузилось. ${error instanceof Error ? error.message : "Попробуйте ещё раз."}`);
          return;
        }
      }
      // While a long upload runs, a live update may already have brought the new task in: never list it twice.
      setStore((current) => ({ ...current, tasks: modal.task ? current.tasks.map((item) => item.id === modal.task?.id ? { ...saved, feedOrder: item.feedOrder } : item) : [...current.tasks.filter((item) => item.id !== saved.id), saved] }));
      setTaskFiles([]);
      setTaskVideoFile(null);
      setTaskVideoRemoving(false);
      setModal(null);
      setToast("Задание сохранено." + videoNotice);
    } catch {
      setToast("Не удалось сохранить задание.");
    } finally {
      setModalBusy(false);
      setModalBusyLabel(undefined);
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
    if (!task || taskActionBusy) return;
    setTaskActionBusy(id);
    try {
      const updated = await updateAdminTask(id, { isActive: !task.isActive });
      setStore((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === id ? { ...updated, feedOrder: item.feedOrder, attachments: item.attachments } : item) }));
      setToast(updated.isActive ? "Задание активировано." : "Задание скрыто.");
    } catch {
      setToast("Не удалось изменить статус задания.");
    } finally { setTaskActionBusy(""); }
  }

  async function pinTask(task: Task) {
    if (taskActionBusy) return;
    setTaskActionBusy(task.id);
    try {
      const updated = await updateAdminTask(task.id, { isPinned: !task.isPinned });
      setStore((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === updated.id ? { ...updated, attachments: item.attachments } : item) }));
    } catch (error) { setToast(error instanceof Error ? error.message : "Не удалось изменить закрепление."); }
    finally { setTaskActionBusy(""); }
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
  const sections: Array<[AdminSection, string]> = [
    ["dashboard", "Обзор"], ["review", "Проверка работ"], ["feedback", "Обратная связь"], ["tasks", "Задания"], ["programs", "Программы"],
    ["announcements", "Объявления"], ["stars", "Звёзды"], ["network", "Структура сети"], ["history", "История проверок"], ["welcome-video", "Приветственное видео"],
  ];
  const queue = reviewQueue(store.submissions);
  const sectionCount = (id: AdminSection) => id === "review" ? counts.pending : id === "feedback" ? feedbackNeedsReply : id === "requests" ? counts.requests : 0;
  const menuBadge = canReview ? counts.pending + feedbackNeedsReply + counts.requests : 0;
  const visibleSections = sections.filter(([id]) => (id === "tasks" || id === "programs" || id === "announcements" || id === "welcome-video") ? canPublishContent : id === "review" || id === "feedback" || id === "history" || id === "stars" ? canReview : true);

  return <><main className="admin-shell" ref={shellRef}>
    <header className="admin-topbar"><button type="button" className="admin-mobile-menu-button" aria-label={menuBadge ? `Открыть меню, ждут внимания: ${menuBadge}` : "Открыть меню"} aria-expanded={mobileMenuOpen} aria-controls="mentor-mobile-menu" onClick={() => setMobileMenuOpen(true)}><span /><span /><span />{menuBadge > 0 && <b className="admin-menu-badge">{menuBadge > 99 ? "99+" : menuBadge}</b>}</button><a className="brand" href="/"><img className="brand-logo" src="/brand/logo.svg" alt="Прокачка" /></a><div className="admin-top-actions"><a className="admin-back-link" href="/">← Обычный интерфейс</a><button type="button" className="avatar-button" aria-label="Открыть профиль" onClick={() => setProfileOpen(true)}><Avatar name={authUser.name} src={authUser.avatarUrl} className="header-avatar" eager /></button></div></header>
    <div className="admin-layout">
      <aside className="admin-sidebar"><p className="eyebrow">Управление</p><nav>
{visibleSections.map(([id, label]) => <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}><span>{adminIcons[id]}</span>{label}{sectionCount(id) > 0 && <b>{sectionCount(id)}</b>}</button>)}
        {canReview && <button className={section === "requests" ? "active" : ""} onClick={() => setSection("requests")}><span>{adminIcons.requests}</span>Заявки{counts.requests > 0 && <b>{counts.requests}</b>}</button>}
      </nav>
        <div className="admin-sidebar-footer"><TelegramConnect telegramId={authUser.telegramId} busy={telegramBusy} onLink={linkTelegram} onRefresh={checkTelegram} /><button type="button" className="logout-button" onClick={logout}><span>{logoutIcon}</span>Выйти</button></div>
      </aside>
      <section className={`admin-content${section === "feedback" ? " admin-content-feedback" : ""}`}><div className="admin-heading"><div><p className="eyebrow">Панель наставника</p><h1>{section === "dashboard" ? `Добрый день, ${authUser.name || "наставник"}` : section === "tasks" ? "Задания" : section === "review" ? "Проверка работ" : section === "feedback" ? "Обратная связь" : section === "history" ? "История проверок" : section === "announcements" ? "Объявления" : section === "programs" ? "Программы" : section === "welcome-video" ? "Приветственное видео" : section === "stars" ? "Звёзды" : section === "network" ? "Структура сети" : "Заявки в команду"}</h1></div><div className="admin-heading-actions">{section === "tasks" && canPublishContent && <><button type="button" className="button button-edit admin-secondary-button" onClick={() => setTaskOrderOpen(true)}>↕ Порядок</button><button type="button" className="admin-create-button" onClick={() => openTaskModal()}><span aria-hidden="true">+</span>Создать задание</button></>}{section === "programs" && canPublishContent && <button type="button" className="admin-create-button" onClick={() => setProgramEditorOpen(true)}><span aria-hidden="true">+</span>Создать программу</button>}</div></div>
        <SectionBoundary key={section} loading={dataLoading} error={dataError} onRetry={() => void refreshData()}>
        {section === "dashboard" && <AdminDashboard store={store} queue={queue} feedbackNeedsReply={feedbackNeedsReply} requests={counts.requests} canReview={canReview} now={now} onNavigate={setSection} />}
        {section === "tasks" && <div className="programs-panel">
          <ReadyProgramsPanel programs={store.programs} tasks={store.tasks} actorId={authUser.id} canManageAll={authUser.role === "admin"} onChange={(programs, tasks) => setStore((current) => ({ ...current, programs, tasks }))} onError={setToast} />
          <TasksView store={store} onOpenResults={(task) => setResultsTaskId(task.id)} actorId={authUser.id} canManageAll={authUser.role === "admin"} onToggle={toggleTask} onEdit={openTaskModal} onRemove={openDeleteModal} onPin={(task) => void pinTask(task)} busyId={taskActionBusy} />
        </div>}
        {section === "review" && <ReviewView store={store} submissions={queue} onReview={(submission, intent) => setReviewFlow({ startId: submission.id, intent })} onStart={() => { if (queue[0]) setReviewFlow({ startId: queue[0].id }); }} onEditTemplates={templates.canEdit ? () => setTemplatesEditorOpen(true) : undefined} />}
{section === "feedback" && <FeedbackPanel viewerId={authUser.id} mentor refreshKey={feedbackVersion} templates={templates.list.length ? templates.list : DEFAULT_REVIEW_TEMPLATES} onOpenSubmission={openSubmission} selectedThreadId={typeof window !== "undefined" ? new URLSearchParams(window.location?.search || "").get("feedback") : null} />}
        {section === "history" && <HistoryView store={store} programs={programHistory} publications={publicationHistory} onReview={openReviewModal} actorId={authUser.id} canNudge={authUser.role === "admin" || authUser.canReview || authUser.canPublishTasks} onNotice={setToast} onComplete={authUser.role === "admin" || authUser.canReview ? openCompletionModal : undefined} />}{section === "programs" && <ProgramsPanel history={programHistory} taskBusyId={taskActionBusy} onEditTask={openTaskModal} onToggleTask={toggleTask} onRemoveTask={openDeleteModal} programs={store.programs} tasks={store.tasks} actorId={authUser.id} canManageAll={authUser.role === "admin"} onChange={(programs, tasks) => setStore((current) => ({ ...current, programs, tasks }))} onError={setToast} />}{section === "announcements" && <AnnouncementsPanel announcements={store.announcements} actorId={authUser.id} canManageAll={authUser.role === "admin"} onChange={(announcements) => setStore((current) => ({ ...current, announcements }))} onError={setToast} onNotice={setToast} />}{section === "stars" && <StarsPanel actorId={authUser.id} users={store.users} awards={store.starAwards} onChange={(starAwards) => setStore((current) => ({ ...current, starAwards }))} onError={setToast} />}
        {section === "requests" && <RequestsPanel requests={pendingRequests} users={store.users} onReview={reviewRequest} />}
        {section === "network" && <NetworkPanel authUser={authUser} users={networkUsers} onChange={setNetworkUsers} onError={setToast} />}
        {section === "welcome-video" && canPublishContent && <WelcomeVideoSettingsPanel user={authUser} />}
        </SectionBoundary>
      </section>
    </div>
    <MobileDrawer open={mobileMenuOpen} onClose={closeMobileMenu}>
      <button type="button" className="admin-drawer-profile" onClick={() => { setProfileOpen(true); setMobileMenuOpen(false); }}><Avatar name={authUser.name} src={authUser.avatarUrl} className="admin-drawer-avatar" /><span><strong>{authUser.name}</strong><small>Мой профиль</small></span><i aria-hidden="true">{profileIcon}</i></button>
      <nav className="admin-drawer-grid" aria-label="Разделы">
        {[...visibleSections, ...(canReview ? [["requests", "Заявки"] as [AdminSection, string]] : [])].map(([id, label]) => <button type="button" key={id} className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => { setSection(id); setMobileMenuOpen(false); }}>
          <span className="admin-drawer-icon">{adminIcons[id]}</span><span className="admin-drawer-label">{id === "welcome-video" ? "Видео" : label}</span>{sectionCount(id) > 0 && <b>{sectionCount(id)}</b>}
        </button>)}
      </nav>
      <div className="admin-drawer-footer">
        <TelegramConnect telegramId={authUser.telegramId} busy={telegramBusy} onLink={linkTelegram} onRefresh={checkTelegram} />
        <a className="admin-drawer-link" href="/" onClick={() => setMobileMenuOpen(false)}><span>{homeIcon}</span>Обычный интерфейс</a>
        <button type="button" className="admin-drawer-link admin-drawer-logout" onClick={logout}><span>{logoutIcon}</span>Выйти</button>
      </div>
    </MobileDrawer>
    {profileOpen && <ProfileDialog user={authUser} onClose={() => setProfileOpen(false)} onSaved={(updated) => { setAuthUser(updated); setToast("Профиль обновлён."); void refreshData(); }} />}
    {taskOrderOpen && <TaskOrderDialog onClose={() => setTaskOrderOpen(false)} onSaved={() => { setTaskOrderOpen(false); setToast("Порядок заданий сохранён."); void refreshData(); }} />}
    {programEditorOpen && <ProgramEditorModal onClose={() => setProgramEditorOpen(false)} onError={setToast} onCreated={(program, tasks) => setStore((current) => ({ ...current, programs: [...current.programs, program], tasks: [...current.tasks, ...tasks] }))} />}
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
    <PullToRefresh onRefresh={async () => { setFeedbackVersion((value) => value + 1); await refreshData(); }} />
    {reviewFlow && <ReviewFlow queue={reviewFlow.single ? store.submissions.filter((item) => item.id === reviewFlow.startId) : queue} startId={reviewFlow.startId} intent={reviewFlow.intent} store={store} templates={templates.list} canEditTemplates={templates.canEdit}
      onSave={saveDecision} onEditTemplates={() => setTemplatesEditorOpen(true)} onClose={() => setReviewFlow(null)} />}
    {resultsTaskId && store.tasks.some((task) => task.id === resultsTaskId) && <TaskResultsSheet task={store.tasks.find((task) => task.id === resultsTaskId)!} store={store} actorId={authUser.id}
      canNudge={authUser.role === "admin" || authUser.canReview || authUser.canPublishTasks} onNotice={setToast}
      onReview={openReviewModal} onComplete={authUser.role === "admin" || authUser.canReview ? openCompletionModal : undefined} onClose={() => setResultsTaskId("")} />}
    {templatesEditorOpen && <ReviewTemplatesEditor initial={templates.list} onSave={storeTemplates} onClose={() => setTemplatesEditorOpen(false)} />}
    {modal?.type === "task" && <TaskEditorModal taskId={modal.task?.id} task={modal.task} draft={taskDraft} editing={Boolean(modal.task)} busy={modalBusy} busyLabel={modalBusyLabel} video={{ file: taskVideoFile, removing: taskVideoRemoving, onFile: setTaskVideoFile, onRemove: setTaskVideoRemoving, onError: setToast }} attachments={taskAttachments} files={taskFiles} onFilesChange={setTaskFiles} onRemoveAttachment={(attachment) => void removeTaskFile(attachment)} onChange={(key, value) => setTaskDraft((current) => ({ ...current, [key]: value }))} onClose={closeModal} onSubmit={saveTask} />}
    {modal?.type === "review" && <ReviewModal draft={reviewDraft} status={modal.status} maxPoints={store.tasks.find((task) => task.id === modal.submission.taskId)?.maxPoints ?? modal.submission.taskMaxPoints ?? 0} busy={modalBusy} onChange={(key, value) => setReviewDraft((current) => ({ ...current, [key]: value }))} onClose={closeModal} onSubmit={(event) => { event.preventDefault(); void submitReview(); }} />}
    {modal?.type === "complete" && <CompletionModal task={modal.task} memberName={modal.member.name} draft={reviewDraft} busy={modalBusy} onChange={(key, value) => setReviewDraft((current) => ({ ...current, [key]: value }))} onClose={closeModal} onSubmit={(event) => { event.preventDefault(); void submitCompletion(); }} />}
    {modal?.type === "delete" && <DeleteModal task={modal.task} busy={modalBusy} onClose={closeModal} onConfirm={() => { void confirmDeleteTask(); }} />}
  </main><WelcomeVideoGate user={authUser} /></>;
}

