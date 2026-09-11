"use client";

import { useEffect, useState } from "react";
import { useAutoRefresh } from "@/frontend/shared/hooks/use-auto-refresh";
import { AuthScreen } from "@/frontend/features/auth/AuthScreen";
import { TeamSelectionScreen } from "@/frontend/features/teams/TeamSelectionScreen";
import { externalHref, formatDate, formatDateTime } from "@/frontend/shared/lib/format";
import { authFetch, clearDevSession, createMemberSubmission, createTelegramLink, loadMemberData, loadTelegramLinkStatus, mapAuthUserToUser, refreshAuthSession } from "@/frontend/shared/api/client";
import { TelegramConnect } from "@/frontend/features/telegram/TelegramConnect";
import { AnnouncementsBlock } from "@/frontend/features/announcements/AnnouncementsBlock";
import { createNetworkInvitation } from "@/frontend/shared/api/network-client";
import type { AuthUser, RankEntry, Store, Submission, SubmissionStatus, Task, User } from "@/shared/domain/types";

type MemberStatus = SubmissionStatus | "missed";
type MemberTab = "home" | "tasks" | "ranking" | "network" | "profile";

function statusLabel(status: MemberStatus | undefined) {
  if (status === "accepted") return "Принято";
  if (status === "pending") return "На проверке";
  if (status === "revision") return "На доработке";
  if (status === "missed") return "Просрочено";
  return "Не начато";
}

function isExpired(task: Task) {
  const deadline = task.dueAt || task.deadlineAt;
  return Boolean(deadline && new Date(deadline).getTime() <= Date.now());
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function hasMentorAccess(user: AuthUser) {
  return user.role === "admin" || Boolean(user.canReview || user.canPublishTasks);
}

function MemberSidebar({ tab, onChange }: { tab: MemberTab; onChange: (tab: MemberTab) => void }) {
  const items: Array<[Exclude<MemberTab, "profile">, string, string]> = [
    ["home", "Обзор", "⌂"],
    ["tasks", "Задания", "☷"],
    ["ranking", "Рейтинг", "♛"],
    ["network", "Моя сеть", "⌘"],
  ];
  return <aside className="member-sidebar"><p className="eyebrow">Навигация</p><nav className="member-sidebar-nav">{items.map(([id, label, icon]) => <button type="button" key={id} className={tab === id ? "active" : ""} onClick={() => onChange(id)} aria-current={tab === id ? "page" : undefined}><span>{icon}</span>{label}</button>)}<button type="button" className={tab === "profile" ? "active" : ""} onClick={() => onChange("profile")} aria-current={tab === "profile" ? "page" : undefined}><span>◌</span>Профиль</button></nav><div className="member-sidebar-note"><span>✦</span><strong>Твой маршрут роста</strong><p>Задания, рейтинг и структура команды — в отдельных разделах.</p></div></aside>;
}

export function MemberApp() {
  const [store, setStore] = useState<Store>({ users: [], tasks: [], programs: [], programProgress: [], announcements: [], starAwards: [], submissions: [] });
  const [teamRanking, setTeamRanking] = useState<RankEntry[]>([]);
  const [starRanking, setStarRanking] = useState<RankEntry[]>([]);
  const [networkUsers, setNetworkUsers] = useState<User[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState<MemberTab>("home");
  const [ratingType, setRatingType] = useState<"points" | "stars">("points");
  const [taskView, setTaskView] = useState<"regular" | "programs">("programs");
  const [toast, setToast] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [teamRequired, setTeamRequired] = useState(false);
  const [, setClock] = useState(() => Date.now());
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        const nextUser = await refreshAuthSession();
        if (nextUser.role === "ceo") { window.location.href = "/ceo"; return; }
        if (nextUser.role === "admin") { window.location.href = "/admin"; return; }
        if (!nextUser.teamId) { setTeamRequired(true); setAuthLoading(false); return; }
        const data = await loadMemberData(nextUser.id);
        if (cancelled) return;
        setStore(data.store);
        setTeamRanking(data.ranking);
        setStarRanking(data.starRanking);
        setNetworkUsers(data.network);
        setUser(mapAuthUserToUser(nextUser));
      } catch {
        if (!cancelled) setToast("Не удалось загрузить данные. Попробуйте обновить страницу.");
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }
    void restoreSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useAutoRefresh(async () => {
    if (!user) return;
    try {
      const currentUser = await refreshAuthSession();
      if (currentUser.role !== "member" || !currentUser.teamId) return;
      setUser(mapAuthUserToUser(currentUser));
      const data = await loadMemberData(currentUser.id);
      setStore(data.store);
      setTeamRanking(data.ranking);
      setStarRanking(data.starRanking);
      setNetworkUsers(data.network);
    } catch {
      // Фоновое обновление не должно прерывать работу пользователя.
    }
  }, { enabled: Boolean(user), intervalMs: 15000 });

  const ranking = ratingType === "stars" ? starRanking : teamRanking;
  const currentRank = user ? ranking.findIndex((member) => member.id === user.id) + 1 : 0;
  const currentPoints = user ? teamRanking.find((member) => member.id === user.id)?.points ?? 0 : 0;
  const currentStars = user ? starRanking.find((member) => member.id === user.id)?.points ?? 0 : 0;
  const activeTasks = store.tasks.filter((task) => task.isActive && (task.publicationType === "sequential" || !isExpired(task))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visibleTasks = activeTasks.filter((task) => taskView === "programs" ? task.publicationType === "sequential" : task.publicationType !== "sequential");

  async function hydrateUser(nextUser: AuthUser) {
    if (nextUser.role === "ceo") { window.location.href = "/ceo"; return; }
    if (nextUser.role === "admin") { window.location.href = "/admin"; return; }
    if (!nextUser.teamId) { setTeamRequired(true); setAuthLoading(false); return; }
    try {
      const data = await loadMemberData(nextUser.id);
      setStore(data.store);
      setTeamRanking(data.ranking);
      setStarRanking(data.starRanking);
      setNetworkUsers(data.network);
      setUser(mapAuthUserToUser(nextUser));
    } catch {
      setToast("Не удалось загрузить данные. Попробуйте ещё раз.");
    }
    finally {
      setAuthLoading(false);
    }
  }

  function handleAuthenticated(nextUser: AuthUser) {
    void hydrateUser(nextUser);
  }

  async function logout() {
    clearDevSession();
    await authFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/";
  }

  async function submitTask(taskId: string) {
    if (!user) { setShowLogin(true); return; }
    if (!user.telegramId) { setTab("profile"); setToast("Сначала привяжите Telegram в профиле."); return; }
    const task = store.tasks.find((item) => item.id === taskId);
    if (!task || (isExpired(task) && task.publicationType !== "sequential")) {
      setToast("Срок отправки этого задания уже истёк.");
      return;
    }
    setToast("Отправляем работу...");
    try {
      const submission = await createMemberSubmission(user.id, taskId);
      setStore((current) => ({
        ...current,
        submissions: [submission, ...current.submissions.filter((item) => !(item.userId === user.id && item.taskId === taskId && item.status !== "accepted"))],
      }));
      window.location.assign(`/api/telegram/start?taskId=${encodeURIComponent(taskId)}`);
      setToast("Telegram открыт. Отправьте фото или видео боту, затем вернитесь сюда.");
    } catch {
      setToast("Не удалось отправить работу. Попробуйте ещё раз.");
    }
  }

  async function linkTelegram() {
    if (!user) return;
    setTelegramBusy(true);
    try {
      const result = await createTelegramLink();
      if (result.linked) {
        setUser({ ...user, telegramId: result.telegramId });
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
    if (!user) return;
    setTelegramBusy(true);
    try {
      const result = await loadTelegramLinkStatus();
      setUser({ ...user, telegramId: result.telegramId });
      if (!silent) setToast(result.linked ? "Telegram привязан. Можно отправлять работы." : "Telegram пока не привязан.");
    } catch {
      setToast("Не удалось проверить привязку Telegram.");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function createInviteLink() {
    if (!user || !user.teamId) return;
    setInviteBusy(true);
    try {
      const result = await createNetworkInvitation();
      setInviteUrl(result.url);
      setToast("Бессрочная ссылка готова. Её можно использовать много раз.");
    } catch {
      setToast("Не удалось создать ссылку приглашения.");
    } finally {
      setInviteBusy(false);
    }
  }
  async function copyInviteLink(url: string) {
    if (!navigator.clipboard) {
      setToast("Не удалось скопировать ссылку. Скопируйте её вручную.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setToast("Скопировано");
    } catch {
      setToast("Не удалось скопировать ссылку. Скопируйте её вручную.");
    }
  }
  if (authLoading) return <div className="auth-loading">Загрузка профиля...</div>;
  if (teamRequired) return <TeamSelectionScreen onCompleted={() => window.location.reload()} />;
  if (!user) return <AuthScreen onAuthenticated={handleAuthenticated} />;

  return <main className={`app-shell member-shell member-tab-${tab}`}>
    <header className="topbar"><a className="brand" href="/" aria-label="На главную"><img className="brand-logo" src="/brand/logo.svg" alt="Прокачка" /></a><div className="topbar-actions">{hasMentorAccess(user) && <a className="mentor-link" href="/admin">Панель наставника</a>}<button className="logout-link" onClick={logout}>Выйти</button><button className="avatar-button" onClick={() => setTab("profile")} aria-label="Открыть профиль">{initials(user.name)}</button></div></header>
    <div className="member-layout"><MemberSidebar tab={tab} onChange={setTab} /><div className="member-main">
    <section className="welcome-section page-width"><div><p className="eyebrow">Твой маршрут роста</p><h1>Привет, {user.name.split(" ")[0]} <span className="wave">⌁</span></h1><p className="welcome-note">Маленькие действия каждый день превращаются в большой результат.</p></div><div className="score-card"><span className="score-label">Общий результат</span><div className={"score-value " + (ratingType === "stars" ? "is-stars" : "")}><strong>{ratingType === "stars" ? currentStars : currentPoints}</strong><span className="score-unit">{ratingType === "stars" ? "★ звёзд" : "баллов"}</span></div><span className="rank-line">{currentRank ? `${currentRank} место в рейтинге` : "Пока нет места в рейтинге"} <i>↗</i></span></div></section>
    <div className="page-width content-grid"><section className="main-column"><div className="member-section member-section-announcements"><AnnouncementsBlock announcements={store.announcements} /></div><div className="member-section member-section-network"><MemberNetwork users={networkUsers} currentUserId={user.id} /></div><div className="member-section member-section-tasks"><div className="section-heading"><div><p className="eyebrow">Практика</p><h2>Актуальные задания</h2></div><div className="task-switch"><button className={taskView === "programs" ? "active" : ""} onClick={() => setTaskView("programs")}>Программы</button><button className={taskView === "regular" ? "active" : ""} onClick={() => setTaskView("regular")}>Задания</button></div><span className="task-count">{visibleTasks.length} заданий</span></div>{visibleTasks.length === 0 ? <EmptyState text="Пока нет активных заданий." /> : <div className="task-list">{visibleTasks.map((task, index) => {
      const submissions = store.submissions.filter((submission) => submission.userId === user.id && submission.taskId === task.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      const latest = submissions[0];
      const effectiveStatus: MemberStatus | undefined = latest?.status ?? (isExpired(task) ? "missed" : undefined);
      const resourceHref = externalHref(task.resourceUrl);
      return <article className={`task-card ${latest?.status === "accepted" ? "is-done" : ""}`} key={task.id}><div className="task-top"><span className="task-number">{String(index + 1).padStart(2, "0")}</span><span className={`status-pill status-${effectiveStatus ?? "new"}`}><span className="status-dot" />{statusLabel(effectiveStatus)}</span></div><h3>{task.title}</h3><p>{task.description}</p>{resourceHref && <a className="resource-link task-resource-link" href={resourceHref} target="_blank" rel="noopener noreferrer">Открыть материал <span>↗</span></a>}{(task.dueAt || task.deadlineAt) && <span className="task-deadline">{task.publicationType === "sequential" ? "Срок шага: " : "Дедлайн: "}{formatDateTime(String(task.dueAt || task.deadlineAt))}</span>}{latest?.status === "revision" && <div className="comment-box"><strong>Комментарий наставника</strong><span>{latest.comment || "Проверь работу и отправь ещё раз."}</span></div>}<div className="task-footer"><span className="points-hint">до <b>{task.maxPoints}</b> баллов</span>{latest?.status === "accepted" ? <span className="accepted-score">Принято +{latest.points}</span> : latest?.status === "pending" ? <span className="pending-action">Материал отправлен</span> : <button className="primary-button" onClick={() => { void submitTask(task.id); }}>{latest?.status === "revision" ? "Отправить повторно" : task.publicationType === "sequential" && isExpired(task) ? "Отправить с опозданием" : "Отправить работу"}<span>↗</span></button>}</div>{latest && <div className="submitted-at">Последняя попытка · {formatDateTime(latest.submittedAt)}</div>}</article>;
    })}</div>}<TelegramConnect telegramId={user.telegramId} busy={telegramBusy} onLink={linkTelegram} onRefresh={checkTelegram} /></div></section><aside className="side-column member-section member-section-ranking"><div className="section-heading ranking-heading"><div className="ranking-title"><div><p className="eyebrow">Команда</p><h2>Рейтинг</h2></div><span className="trophy">♛</span></div><div className="rating-switch"><button className={ratingType === "points" ? "active" : ""} onClick={() => setRatingType("points")}>Баллы</button><button className={ratingType === "stars" ? "active" : ""} onClick={() => setRatingType("stars")}>Звёзды</button></div></div>{ranking.length === 0 ? <EmptyState text="Рейтинг пока пуст." /> : <div className={"ranking-list " + (ratingType === "stars" ? "stars-ranking-list" : "")}>{ranking.map((member, index) => <div className={`rank-row ${member.id === user.id ? "current" : ""}`} key={member.id}><span className={`rank-position rank-${index + 1}`}>{index + 1}</span><span className="rank-avatar">{initials(member.name)}</span><span className="rank-name">{member.name}{member.id === user.id && <small>это вы</small>}</span><strong>{member.points}{ratingType === "stars" ? " ★" : ""}</strong></div>)}</div>}<div className="ranking-footer">{ratingType === "stars" ? "Звёзды выдаёт наставник вручную" : "Баллы начисляются после проверки наставником"}</div></aside></div></div></div>
    <nav className="bottom-nav"><button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}><span>⌂</span><span className="bottom-nav-label">Обзор</span></button><button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}><span>☷</span><span className="bottom-nav-label">Задания</span></button><button className={tab === "ranking" ? "active" : ""} onClick={() => setTab("ranking")}><span>♛</span><span className="bottom-nav-label">Рейтинг</span></button><button className={tab === "network" ? "active" : ""} onClick={() => setTab("network")}><span>⌘</span><span className="bottom-nav-label">Сеть</span></button><button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}><span>◌</span><span className="bottom-nav-label">Профиль</span></button></nav>
    {tab === "profile" && <ProfileModal user={user} store={store} rank={currentRank} points={currentPoints} stars={store.starAwards.filter((award) => award.userId === user.id).reduce((sum, award) => sum + award.stars, 0)} telegramBusy={telegramBusy} onLinkTelegram={linkTelegram} onRefreshTelegram={checkTelegram} inviteUrl={inviteUrl} inviteBusy={inviteBusy} onCreateInvite={createInviteLink} onCopyInvite={copyInviteLink} onClose={() => setTab("home")} />}
    {showLogin && <div className="modal-backdrop" onClick={() => setShowLogin(false)}><div className="simple-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowLogin(false)}>×</button><p className="eyebrow">Нужна идентификация</p><h2>Сначала представься</h2><p>Войди или создай аккаунт, чтобы отправить работу.</p><button className="primary-button full" onClick={() => { setShowLogin(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Перейти ко входу</button></div></div>}
    {toast && <div className="toast">{toast}</div>}
  </main>;
}

function EmptyState({ text }: { text: string }) { return <div className="empty-state"><span>◌</span><p>{text}</p></div>; }

function networkDepth(users: User[], user: User) {
  const byId = new Map(users.map((item) => [item.id, item]));
  let depth = 0;
  let current = user;
  const seen = new Set<string>();
  while (current.parentUserId && !seen.has(current.id) && depth < users.length) {
    seen.add(current.id);
    const parent = byId.get(current.parentUserId);
    if (!parent) break;
    current = parent;
    depth += 1;
  }
  return depth;
}

function MemberNetwork({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const orderedUsers = [...users].sort((a, b) => networkDepth(users, a) - networkDepth(users, b) || a.name.localeCompare(b.name));
  return <section className="member-network-card"><div className="member-network-heading"><div><p className="eyebrow">Твоя команда</p><h2>Моя структура</h2></div><span>{Math.max(orderedUsers.length - 1, 0)} участников ниже</span></div>{orderedUsers.length === 0 ? <EmptyState text="Структура пока загружается." /> : <div className="member-network-list">{orderedUsers.map((item) => <div className={`member-network-row ${item.id === currentUserId ? "is-current" : ""}`} key={item.id} style={{ "--network-depth": networkDepth(users, item) } as React.CSSProperties}><span className="rank-avatar">{initials(item.name)}</span><div><strong>{item.id === currentUserId ? "Ты" : item.name}</strong><small>{item.id === currentUserId ? item.name : "Участник твоей сети"}</small></div>{item.id === currentUserId && <b>Корень сети</b>}</div>)}</div>}</section>;
}

type HistoryItem = { id: string; title: string; date: string; status: MemberStatus; points: number; comment: string };

function ProfileModal({ user, store, rank, points, stars, telegramBusy, onLinkTelegram, onRefreshTelegram, inviteUrl, inviteBusy, onCreateInvite, onCopyInvite, onClose }: { user: User; store: Store; rank: number; points: number; stars: number; telegramBusy: boolean; onLinkTelegram: () => void; onRefreshTelegram: () => void; inviteUrl: string; inviteBusy: boolean; onCreateInvite: () => void; onCopyInvite: (url: string) => void; onClose: () => void }) {
  const submissions = store.submissions.filter((submission) => submission.userId === user.id);
  const submittedTaskIds = new Set(submissions.map((submission) => submission.taskId));
  const history: HistoryItem[] = [
    ...submissions.map((submission) => ({ id: submission.id, title: store.tasks.find((task) => task.id === submission.taskId)?.title || "Задание", date: submission.submittedAt, status: submission.status as MemberStatus, points: submission.points, comment: submission.comment })),
    ...store.tasks.filter((task) => isExpired(task) && !submittedTaskIds.has(task.id)).map((task) => ({ id: `missed-${task.id}`, title: task.title, date: task.dueAt || task.deadlineAt || task.createdAt, status: "missed" as const, points: 0, comment: "Срок сдачи истёк, отправить работу больше нельзя." })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return <div className="modal-backdrop" onClick={onClose}><div className="profile-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose}>×</button><div className="profile-header"><div className="profile-avatar">{initials(user.name)}</div><div><p className="eyebrow">Профиль участника</p><h2>{user.name}</h2><span>Участник команды</span></div></div><div className="profile-stats"><div><strong>{points}</strong><span>баллов</span></div><div><strong>{rank || "—"}</strong><span>место</span></div><div><strong>{submissions.filter((item) => item.status === "accepted").length}</strong><span>выполнено</span></div><div><strong>{stars}</strong><span>звёзд</span></div></div><TelegramConnect telegramId={user.telegramId} busy={telegramBusy} onLink={onLinkTelegram} onRefresh={onRefreshTelegram} />{user.teamId && <div className="profile-invite-card"><div><p className="eyebrow">Приглашения</p><strong>Твоя ссылка в команду</strong><small>Одна бессрочная ссылка. Её можно использовать много раз, а вступление подтверждает наставник.</small></div>{inviteUrl ? <div className="profile-invite-controls"><input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="button button-edit" onClick={() => { void onCopyInvite(inviteUrl); }}>Копировать</button></div> : <button type="button" className="button button-primary" disabled={inviteBusy} onClick={onCreateInvite}>{inviteBusy ? "Создаём..." : "Получить ссылку"}</button>}</div>}<h3>История заданий</h3><div className="history-list">{history.length === 0 ? <EmptyState text="Ты ещё ничего не отправлял." /> : history.map((item) => <div className="history-row" key={item.id}><div><strong>{item.title}</strong><span>{formatDate(item.date)}</span>{item.comment && <small>{item.comment}</small>}</div><div className={`history-status status-${item.status}`}>{statusLabel(item.status)}{item.status === "accepted" && ` +${item.points}`}</div></div>)}</div></div></div>;
}
