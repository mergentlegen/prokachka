"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AuthScreen } from "@/frontend/features/auth/AuthScreen";
import { authFetch, clearDevSession, refreshAuthSession } from "@/frontend/shared/api/client";
import { useAutoRefresh } from "@/frontend/shared/hooks/use-auto-refresh";
import { createCeoTeam, deleteCeoTeam, deleteCeoUser, loadCeoData, reviewCeoRequest, updateCeoTeam, updateCeoUser } from "@/frontend/shared/api/ceo-client";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import { formatDate, formatDateTime } from "@/frontend/shared/lib/format";
import type { AuthUser, Team, TeamJoinRequest, User, UserRole } from "@/shared/domain/types";

type CeoSection = "overview" | "teams" | "requests" | "users";
type TeamDraft = { id?: string; name: string; description: string; isActive: boolean };
type UserDraft = { id: string; role: "admin" | "member"; teamId: string };
type DeleteTarget = { type: "team"; item: Team } | { type: "user"; item: User } | null;

const sectionLabels: Record<CeoSection, string> = { overview: "Обзор", teams: "Команды", requests: "Заявки", users: "Пользователи" };
const roleLabels: Record<UserRole, string> = { ceo: "CEO", admin: "Наставник", member: "Участник" };
const initials = (name: string) => name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

export function CEOApp() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [section, setSection] = useState<CeoSection>("overview");
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<TeamJoinRequest[]>([]);
  const [toast, setToast] = useState("");
  const [teamDraft, setTeamDraft] = useState<TeamDraft | null>(null);
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null);
  const [actionId, setActionId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  async function refresh(silent = false) {
    if (!silent) setDataLoading(true);
    try {
      const data = await loadCeoData();
      setTeams(data.teams);
      setUsers(data.users);
      setRequests(data.requests);
    } catch {
      setToast("Не удалось загрузить данные CEO-панели.");
    } finally {
      setHasLoaded(true);
      if (!silent) setDataLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        const nextUser = await refreshAuthSession();
        if (!cancelled) {
          setAuthUser(nextUser);
          if (nextUser.role === "ceo") void refresh();
        }
      } catch {
        if (!cancelled) setToast("Не удалось проверить авторизацию.");
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }
    void restoreSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useAutoRefresh(async () => {
    await refresh(true);
  }, { enabled: authUser?.role === "ceo" && hasLoaded && !dataLoading, intervalMs: 30000 });

  const pendingRequests = useMemo(() => requests.filter((request) => request.status === "pending"), [requests]);
  const activeTeams = teams.filter((team) => team.isActive);
  const mentors = users.filter((user) => user.role === "admin");
  const members = users.filter((user) => user.role === "member");

  function handleAuthenticated(nextUser: AuthUser) {
    if (nextUser.role === "ceo") {
      setAuthUser(nextUser);
      void refresh();
      return;
    }
    window.location.href = nextUser.role === "admin" ? "/admin" : "/";
  }

  async function logout() {
    clearDevSession();
    await authFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/";
  }

  async function saveTeam(event: FormEvent) {
    event.preventDefault();
    if (!teamDraft || teamDraft.name.trim().length < 2) return;
    setActionId("team");
    try {
      const saved = teamDraft.id
        ? await updateCeoTeam(teamDraft.id, { name: teamDraft.name.trim(), description: teamDraft.description.trim(), isActive: teamDraft.isActive })
        : await createCeoTeam({ name: teamDraft.name.trim(), description: teamDraft.description.trim() });
      setTeams((current) => teamDraft.id ? current.map((team) => team.id === saved.id ? saved : team) : [saved, ...current]);
      setTeamDraft(null);
      setToast(teamDraft.id ? "Команда обновлена." : "Команда создана.");
    } catch {
      setToast("Не удалось сохранить команду. Проверьте название.");
    } finally {
      setActionId("");
    }
  }

  async function toggleTeam(team: Team) {
    setActionId(team.id);
    try {
      const saved = await updateCeoTeam(team.id, { isActive: !team.isActive });
      setTeams((current) => current.map((item) => item.id === saved.id ? saved : item));
      setToast(saved.isActive ? "Команда снова активна." : "Команда деактивирована.");
    } catch {
      setToast("Не удалось изменить статус команды.");
    } finally {
      setActionId("");
    }
  }

  async function permanentlyDeleteTeam(team: Team) {
    setActionId(`delete-team:${team.id}`);
    try {
      await deleteCeoTeam(team.id);
      setTeams((current) => current.filter((item) => item.id !== team.id));
      setUsers((current) => current.map((user) => user.teamId === team.id ? { ...user, teamId: undefined } : user));
      setRequests((current) => current.filter((request) => request.teamId !== team.id));
      setToast("Команда и её данные удалены.");
    } catch {
      setToast("Не удалось удалить команду.");
    } finally {
      setActionId("");
    }
  }

  function requestDeleteTeam(team: Team) {
    setDeleteTarget({ type: "team", item: team });
  }

  async function saveUserAccess(event: FormEvent) {
    event.preventDefault();
    if (!userDraft) return;
    setActionId(userDraft.id);
    try {
      const saved = await updateCeoUser(userDraft.id, { role: userDraft.role, teamId: userDraft.teamId || null });
      setUsers((current) => current.map((user) => user.id === saved.id ? saved : user));
      setUserDraft(null);
      setToast("Доступ пользователя обновлён.");
    } catch {
      setToast("Не удалось обновить доступ пользователя.");
    } finally {
      setActionId("");
    }
  }

  async function permanentlyDeleteUser(user: User) {
    setActionId(`delete-user:${user.id}`);
    try {
      await deleteCeoUser(user.id);
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setRequests((current) => current.filter((request) => request.userId !== user.id));
      setUserDraft((current) => current?.id === user.id ? null : current);
      setToast("Пользователь удалён.");
    } catch {
      setToast("Не удалось удалить пользователя.");
    } finally {
      setActionId("");
    }
  }

  function requestDeleteUser(user: User) {
    setDeleteTarget({ type: "user", item: user });
  }

  async function resolveRequest(request: TeamJoinRequest, status: "approved" | "rejected") {
    setActionId(request.id);
    try {
      await reviewCeoRequest(request.id, status);
      await refresh();
      setToast(status === "approved" ? "Заявка одобрена, команда назначена." : "Заявка отклонена.");
    } catch {
      setToast("Не удалось обработать заявку.");
    } finally {
      setActionId("");
    }
  }

  if (authLoading) return <div className="auth-loading">Загрузка CEO-панели...</div>;
  if (!authUser) return <AuthScreen onAuthenticated={handleAuthenticated} initialMode="login" />;
  if (authUser.role !== "ceo") return <CeoAccessDenied onLogout={logout} />;

  return <main className="ceo-shell">
    <header className="ceo-topbar">
      <a className="ceo-brand" href="/"><img className="brand-logo" src="/brand/logo.svg" alt="Прокачка" /><span><i>|</i> Центр управления</span></a>
      <div className="ceo-top-actions"><span className="ceo-role">CEO / полный доступ</span><button onClick={logout}>Выйти</button></div>
    </header>
    <div className="ceo-layout">
      <aside className="ceo-sidebar">
        <div className="ceo-profile"><div className="ceo-avatar">C</div><div><strong>Центр управления</strong><span>Все команды и участники</span></div></div>
        <nav className="ceo-nav">{(Object.keys(sectionLabels) as CeoSection[]).map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}><span>{item === "overview" ? "⌂" : item === "teams" ? "◈" : item === "requests" ? "✉" : "♙"}</span>{sectionLabels[item]}{item === "requests" && pendingRequests.length > 0 && <b>{pendingRequests.length}</b>}</button>)}</nav>
        <div className="ceo-sidebar-note"><span>✦</span><strong>Архитектура платформы</strong><p>Роль глобальная, команда назначается отдельно. Поэтому в одной команде может быть несколько наставников.</p></div>
      </aside>
      <section className="ceo-content">
        <div className="ceo-heading"><div><p className="eyebrow">Пульт руководителя</p><h1>{section === "overview" ? "Всё под контролем" : sectionLabels[section]}</h1><p className="ceo-subtitle">Управляйте командами, заявками и доступами из одного места.</p>{dataLoading && hasLoaded && <span className="ceo-sync">Синхронизация данных...</span>}</div>{section === "teams" && <button className="primary-button" onClick={() => setTeamDraft({ name: "", description: "", isActive: true })}>+ Создать команду</button>}</div>
        {dataLoading && !hasLoaded ? <div className="ceo-loading">Обновляем данные...</div> : <>
          {section === "overview" && <Overview activeTeams={activeTeams.length} users={users.length} mentors={mentors.length} pending={pendingRequests.length} requests={pendingRequests} teams={teams} onNavigate={setSection} onResolve={resolveRequest} actionId={actionId} />}
          {section === "teams" && <TeamsView teams={teams} users={users} onEdit={(team) => setTeamDraft({ id: team.id, name: team.name, description: team.description, isActive: team.isActive })} onToggle={toggleTeam} onDelete={requestDeleteTeam} actionId={actionId} />}
          {section === "requests" && <RequestsView requests={requests} onResolve={resolveRequest} actionId={actionId} />}
          {section === "users" && <UsersView users={users} teams={teams} onEdit={(user) => setUserDraft({ id: user.id, role: user.role === "admin" ? "admin" : "member", teamId: user.teamId || "" })} onDelete={requestDeleteUser} actionId={actionId} />}
        </>}
      </section>
    </div>
    <div className="ceo-mobile-nav">{(Object.keys(sectionLabels) as CeoSection[]).map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}><span>{item === "overview" ? "⌂" : item === "teams" ? "◈" : item === "requests" ? "✉" : "♙"}</span>{sectionLabels[item]}{item === "requests" && pendingRequests.length > 0 && <b>{pendingRequests.length}</b>}</button>)}</div>
    {teamDraft && <TeamModal draft={teamDraft} setDraft={setTeamDraft} onSubmit={saveTeam} pending={actionId === "team"} onClose={() => setTeamDraft(null)} />}
    {userDraft && <UserModal draft={userDraft} setDraft={setUserDraft} users={users} teams={teams} onSubmit={saveUserAccess} pending={actionId === userDraft.id} onClose={() => setUserDraft(null)} />}
    {deleteTarget?.type === "team" && <ConfirmModal title="Удалить команду?" description={<>Команда «{deleteTarget.item.name}», её задания, программы, объявления, заявки и рейтинги будут удалены без возможности восстановления.</>} confirmLabel="Удалить команду" busy={actionId === `delete-team:${deleteTarget.item.id}`} onClose={() => setDeleteTarget(null)} onConfirm={() => { void permanentlyDeleteTeam(deleteTarget.item); }} />}
    {deleteTarget?.type === "user" && <ConfirmModal title="Удалить пользователя?" description={<>Профиль «{deleteTarget.item.name}», отправленные работы, звёзды и история будут удалены без возможности восстановления.</>} confirmLabel="Удалить пользователя" busy={actionId === `delete-user:${deleteTarget.item.id}`} onClose={() => setDeleteTarget(null)} onConfirm={() => { void permanentlyDeleteUser(deleteTarget.item); }} />}
    {toast && <div className="toast">{toast}</div>}
  </main>;
}

function Overview({ activeTeams, users, mentors, pending, requests, teams, onNavigate, onResolve, actionId }: { activeTeams: number; users: number; mentors: number; pending: number; requests: TeamJoinRequest[]; teams: Team[]; onNavigate: (section: CeoSection) => void; onResolve: (request: TeamJoinRequest, status: "approved" | "rejected") => void; actionId: string }) {
  return <>
    <div className="ceo-metric-grid"><CeoMetric label="Активные команды" value={activeTeams} note="работают сейчас" icon="◈" /><CeoMetric label="Пользователи" value={users} note="в системе" icon="♙" /><CeoMetric label="Наставники" value={mentors} note="с назначенным доступом" icon="✦" /><CeoMetric label="Новые заявки" value={pending} note="ждут решения" icon="✉" accent={pending > 0} /></div>
    <div className="ceo-overview-grid"><div className="ceo-panel"><div className="ceo-panel-title"><div><p className="eyebrow">Требует внимания</p><h2>Заявки в команды</h2></div><button className="text-button" onClick={() => onNavigate("requests")}>Все заявки →</button></div>{requests.length === 0 ? <CeoEmpty text="Новых заявок нет. Здесь всё спокойно." /> : requests.slice(0, 4).map((request) => <RequestRow key={request.id} request={request} onResolve={onResolve} actionId={actionId} />)}</div><div className="ceo-panel"><div className="ceo-panel-title"><div><p className="eyebrow">Структура</p><h2>Команды</h2></div><button className="text-button" onClick={() => onNavigate("teams")}>Управлять →</button></div>{teams.length === 0 ? <CeoEmpty text="Создайте первую команду." /> : teams.slice(0, 5).map((team) => <div className="ceo-mini-row" key={team.id}><span className={`ceo-team-dot ${team.isActive ? "active" : ""}`} /><div><strong>{team.name}</strong><small>{team.isActive ? "Активна" : "Отключена"}</small></div><b>{team.id ? "→" : ""}</b></div>)}</div></div>
  </>;
}

function TeamsView({ teams, users, onEdit, onToggle, onDelete, actionId }: { teams: Team[]; users: User[]; onEdit: (team: Team) => void; onToggle: (team: Team) => void; onDelete: (team: Team) => void; actionId: string }) {
  if (teams.length === 0) return <div className="ceo-panel"><CeoEmpty text="Пока нет команд. Создайте первую, чтобы участники могли подать заявку." /></div>;
  return <div className="ceo-team-grid">{teams.map((team) => { const members = users.filter((user) => user.teamId === team.id); const mentors = members.filter((user) => user.role === "admin"); return <article className={`ceo-team-card ${!team.isActive ? "inactive" : ""}`} key={team.id}><div className="ceo-team-card-top"><span className="ceo-large-team-icon">◈</span><span className={`ceo-status ${team.isActive ? "on" : "off"}`}>{team.isActive ? "Активна" : "Отключена"}</span></div><h2>{team.name}</h2><p>{team.description || "Описание команды пока не добавлено."}</p><div className="ceo-team-stats"><span><b>{members.length}</b> пользователей</span><span><b>{mentors.length}</b> наставников</span></div><div className="ceo-card-actions"><button className="button button-edit" onClick={() => onEdit(team)}>Изменить</button><button className={"button " + (team.isActive ? "button-warning" : "button-success")} onClick={() => onToggle(team)} disabled={actionId === team.id}>{team.isActive ? "Отключить" : "Активировать"}</button><button className="button button-danger" onClick={() => onDelete(team)} disabled={actionId === `delete-team:${team.id}`}>Удалить</button></div><small className="ceo-created">Создана {formatDate(team.createdAt)}</small></article>; })}</div>;
}

function RequestsView({ requests, onResolve, actionId }: { requests: TeamJoinRequest[]; onResolve: (request: TeamJoinRequest, status: "approved" | "rejected") => void; actionId: string }) {
  return <div className="ceo-panel ceo-request-panel"><div className="ceo-panel-title"><div><p className="eyebrow">Доступ в команды</p><h2>Заявки пользователей</h2></div><span className="ceo-count-label">{requests.filter((request) => request.status === "pending").length} новых</span></div>{requests.length === 0 ? <CeoEmpty text="Заявок пока нет." /> : requests.map((request) => <RequestRow key={request.id} request={request} onResolve={onResolve} actionId={actionId} showDate />)}</div>;
}

function RequestRow({ request, onResolve, actionId, showDate = false }: { request: TeamJoinRequest; onResolve: (request: TeamJoinRequest, status: "approved" | "rejected") => void; actionId: string; showDate?: boolean }) {
  const pending = request.status === "pending";
  return <div className="ceo-request-row"><div className="ceo-user-avatar">{initials(request.userName || "?")}</div><div className="ceo-request-main"><strong>{request.userName || "Пользователь"}</strong><span>хочет в команду <b>{request.teamName || "—"}</b></span>{showDate && <small>{formatDateTime(request.createdAt)}</small>}</div>{pending ? <div className="ceo-request-actions"><button className="button button-success" onClick={() => onResolve(request, "approved")} disabled={actionId === request.id}>Одобрить</button><button className="button button-danger" onClick={() => onResolve(request, "rejected")} disabled={actionId === request.id}>Отклонить</button></div> : <span className={`request-result ${request.status}`}>{request.status === "approved" ? "Одобрена" : "Отклонена"}</span>}</div>;
}

function UsersView({ users, teams, onEdit, onDelete, actionId }: { users: User[]; teams: Team[]; onEdit: (user: User) => void; onDelete: (user: User) => void; actionId: string }) {
  return <div className="ceo-panel ceo-users-panel"><div className="ceo-panel-title"><div><p className="eyebrow">Глобальный доступ</p><h2>Пользователи и роли</h2></div><span className="ceo-count-label">{users.length} всего</span></div>{users.length === 0 ? <CeoEmpty text="Пользователи появятся после регистрации." /> : users.map((user) => <div className="ceo-user-row" key={user.id}><div className="ceo-user-avatar">{initials(user.name)}</div><div className="ceo-user-main"><strong>{user.name}</strong><span>{user.login || "логин не указан"}</span></div><span className={`role-badge role-${user.role}`}>{roleLabels[user.role]}</span><span className="ceo-user-team">{teams.find((team) => team.id === user.teamId)?.name || "Без команды"}</span><button className="button button-edit ceo-edit-access" onClick={() => onEdit(user)}>Настроить</button><button className="button button-danger ceo-delete-user" onClick={() => onDelete(user)} disabled={actionId === `delete-user:${user.id}`}>Удалить</button></div>)}</div>;
}

function TeamModal({ draft, setDraft, onSubmit, pending, onClose }: { draft: TeamDraft; setDraft: (draft: TeamDraft | null) => void; onSubmit: (event: FormEvent) => void; pending: boolean; onClose: () => void }) {
  return <div className="modal-backdrop" onClick={onClose}><form className="ceo-modal" onSubmit={onSubmit} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">{draft.id ? "Настройки команды" : "Новая команда"}</p><h2>{draft.id ? "Изменить команду" : "Создать команду"}</h2><label>Название<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Например, Команда А" autoFocus /></label><label>Короткое описание<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Чем занимается команда" rows={4} /></label>{draft.id && <label className="ceo-checkbox"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} /> Команда активна</label>}<button className="primary-button full" disabled={pending || draft.name.trim().length < 2}>{pending ? "Сохраняем..." : "Сохранить"}</button></form></div>;
}

function UserModal({ draft, setDraft, users, teams, onSubmit, pending, onClose }: { draft: UserDraft; setDraft: (draft: UserDraft | null) => void; users: User[]; teams: Team[]; onSubmit: (event: FormEvent) => void; pending: boolean; onClose: () => void }) {
  const user = users.find((item) => item.id === draft.id);
  return <div className="modal-backdrop" onClick={onClose}><form className="ceo-modal" onSubmit={onSubmit} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">Настройка доступа</p><h2>{user?.name || "Пользователь"}</h2><p className="ceo-modal-note">Роль определяет возможности, команда — область работы наставника или участника.</p><label>Глобальная роль<select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as "admin" | "member" })}><option value="member">Участник</option><option value="admin">Наставник</option></select></label><label>Команда<select value={draft.teamId} onChange={(event) => setDraft({ ...draft, teamId: event.target.value })}><option value="">Без команды</option>{teams.filter((team) => team.isActive).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><button className="primary-button full" disabled={pending}>{pending ? "Сохраняем..." : "Сохранить доступ"}</button></form></div>;
}

function CeoMetric({ label, value, note, icon, accent = false }: { label: string; value: number; note: string; icon: string; accent?: boolean }) { return <div className={`ceo-metric ${accent ? "accent" : ""}`}><span className="ceo-metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>; }
function CeoEmpty({ text }: { text: string }) { return <div className="ceo-empty"><span>◌</span><p>{text}</p></div>; }
function CeoAccessDenied({ onLogout }: { onLogout: () => void }) { return <main className="admin-login"><div className="admin-login-card"><a className="brand" href="/"><img className="brand-logo" src="/brand/logo.svg" alt="Прокачка" /></a><p className="eyebrow">Доступ ограничен</p><h1>Раздел CEO</h1><p>Эта панель доступна только пользователю с глобальной ролью CEO.</p><button className="primary-button full" onClick={() => { void onLogout(); }}>Выйти</button><a className="back-link" href="/">Вернуться к заданиям</a></div></main>; }
