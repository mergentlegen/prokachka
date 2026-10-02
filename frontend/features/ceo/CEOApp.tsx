"use client";

import { Avatar } from "@/frontend/shared/Avatar";
import { Toast } from "@/frontend/shared/Toast";

import { FormEvent, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AuthScreen } from "@/frontend/features/auth/AuthScreen";
import { ApiError, authFetch, clearDevSession, refreshAuthSession } from "@/frontend/shared/api/client";
import { useLiveUpdates } from "@/frontend/shared/hooks/use-live-updates";
import { dataCache } from "@/frontend/shared/api/data-cache";
import { SectionBoundary } from "@/frontend/shared/SectionBoundary";
import { createCeoTeam, deleteCeoTeam, deleteCeoUser, loadCeoData, loadCeoJournal, loadCeoStats, previewCeoUserDeletion, reviewCeoRequest, updateCeoTeam, updateCeoUser, type CeoJournalEntry, type CeoStats, type UserDeletionImpact } from "@/frontend/shared/api/ceo-client";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import { formatDateTime } from "@/frontend/shared/lib/format";
import { FormSheet } from "@/frontend/shared/FormSheet";
import { PullToRefresh } from "@/frontend/shared/PullToRefresh";
import type { AuthUser, Team, TeamJoinRequest, User } from "@/shared/domain/types";
import { CeoOverview, type CeoSection } from "./CeoOverview";
import { CeoTeamSheet, CeoTeamsView } from "./CeoTeams";
import { CeoUserSheet, CeoUsersView } from "./CeoUsers";
import { ceoIcons } from "./CeoIcons";
import { CeoJournalView } from "./CeoJournal";

type TeamDraft = { id?: string; name: string; description: string; isActive: boolean };
type UserDraft = { id: string; role: "admin" | "member"; teamId: string };
type DeleteTarget = { type: "team"; item: Team } | { type: "user"; item: User } | null;

const sectionLabels: Record<CeoSection, string> = { overview: "Обзор", teams: "Команды", requests: "Заявки", users: "Пользователи", journal: "Журнал" };
// Four tabs fit the phone's bottom bar; the journal opens from the top bar and the overview there.
const mobileSections: CeoSection[] = ["overview", "teams", "requests", "users"];

type JournalState = { entries: CeoJournalEntry[]; hasMore: boolean; loading: boolean; failed: boolean };

// Without `before` the first page replaces the list; with it, older entries are appended.
async function loadJournalPage(setJournal: Dispatch<SetStateAction<JournalState>>, before?: number) {
  const epoch = dataCache.epoch;
  const more = before !== undefined;
  setJournal((current) => ({ ...current, loading: true, failed: false }));
  try {
    const page = await loadCeoJournal(before);
    if (epoch !== dataCache.epoch) return;
    setJournal((current) => ({ entries: more ? [...current.entries, ...page.entries.filter((entry) => !current.entries.some((item) => item.id === entry.id))] : page.entries, hasMore: page.hasMore, loading: false, failed: false }));
  } catch {
    if (epoch === dataCache.epoch) setJournal((current) => ({ ...current, loading: false, failed: true }));
  }
}

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
  const [deleteImpact, setDeleteImpact] = useState<UserDeletionImpact | null>(null);
  const [deleteImpactError, setDeleteImpactError] = useState("");
  const [stats, setStats] = useState<CeoStats | null>(null);
  const [openTeamId, setOpenTeamId] = useState("");
  const [openUserId, setOpenUserId] = useState("");
  const [journal, setJournal] = useState<JournalState>({ entries: [], hasMore: false, loading: false, failed: false });
  const refreshRevision = useRef(0);



  async function refresh(silent = false) {
    if (!silent) setDataLoading(true);
    const epoch = dataCache.epoch;
    const revision = refreshRevision.current;
    try {
      const data = await loadCeoData();
      if (epoch !== dataCache.epoch || revision !== refreshRevision.current) return;
      setTeams(data.teams);
      setUsers(data.users);
      setRequests(data.requests);
      // Statistics are a bonus: if they fail, the panel still works.
      void loadCeoStats().then((next) => { if (epoch === dataCache.epoch) setStats(next); }).catch(() => undefined);
      void loadJournalPage(setJournal);
    } catch {
      if (epoch === dataCache.epoch) setToast("Не удалось загрузить данные CEO-панели.");
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

  useEffect(() => {
    if (deleteTarget?.type !== "user") return;
    let cancelled = false;
    const id = deleteTarget.item.id;
    void previewCeoUserDeletion(id).then((impact) => {
      if (!cancelled) setDeleteImpact(impact);
    }).catch((error) => {
      if (!cancelled) setDeleteImpactError(error instanceof ApiError ? error.message : "Не удалось проверить последствия удаления.");
    });
    return () => { cancelled = true; };
  }, [deleteTarget]);

  useLiveUpdates(authUser, async (topics) => {
    try {
      if (topics.includes("session") || topics.includes("resync")) {
        const current = await refreshAuthSession();
        setAuthUser(current);
        if (current.role !== "ceo") { setTeams([]); setUsers([]); setRequests([]); setUserDraft(null); setTeamDraft(null); return; }
      }
      await refresh(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { setAuthUser(null); setTeams([]); setUsers([]); setRequests([]); }
    }
  });

  const pendingRequests = useMemo(() => requests.filter((request) => request.status === "pending"), [requests]);

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

  function editTeam(team: Team) {
    setTeamDraft({ id: team.id, name: team.name, description: team.description, isActive: team.isActive });
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
    if (!deleteImpact || actionId) return;
    setActionId(`delete-user:${user.id}`);
    refreshRevision.current++;
    try {
      const result = await deleteCeoUser(user.id);
      refreshRevision.current++;
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setRequests((current) => current.filter((request) => request.userId !== user.id));
      setUserDraft((current) => current?.id === user.id ? null : current);
      setDeleteTarget(null);
      setToast(result.cleanupPending ? "Профиль удалён. Очистка учётной записи завершится автоматически." : "Пользователь удалён.");
      void refresh(true);
    } catch (error) {
      setToast(error instanceof ApiError ? error.message : "Не удалось удалить пользователя.");
    } finally {
      setActionId("");
    }
  }

  function requestDeleteUser(user: User) {
    setDeleteImpact(null);
    setDeleteImpactError("");
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

  const openTeam = teams.find((team) => team.id === openTeamId);
  const openUser = users.find((user) => user.id === openUserId);
  const navItems = Object.keys(sectionLabels) as CeoSection[];
  const navigate = (next: CeoSection) => { setSection(next); window.scrollTo({ top: 0, behavior: "instant" }); };

  return <main className="ceo-shell">
    <header className="ceo-topbar">
      <a className="ceo-brand" href="/"><img className="brand-logo" src="/brand/logo.svg" alt="Прокачка" /><span><i>|</i> Центр управления</span></a>
      <div className="ceo-top-actions"><button type="button" className={`ceo-journal-link${section === "journal" ? " active" : ""}`} aria-label="Журнал действий" aria-current={section === "journal" ? "page" : undefined} onClick={() => navigate("journal")}><span aria-hidden="true">{ceoIcons.journal}</span></button><button type="button" className="ceo-logout" onClick={logout}><span aria-hidden="true">{ceoIcons.logout}</span><span className="ceo-logout-label">Выйти</span></button></div>
    </header>
    <div className="ceo-layout">
      <aside className="ceo-sidebar">
        <div className="ceo-profile"><div className="ceo-avatar">C</div><div><strong>Центр управления</strong><span>Все команды и участники</span></div></div>
        <nav className="ceo-nav">{navItems.map((item) => <button key={item} className={section === item ? "active" : ""} aria-current={section === item ? "page" : undefined} onClick={() => navigate(item)}><span>{ceoIcons[item]}</span>{sectionLabels[item]}{item === "requests" && pendingRequests.length > 0 && <b>{pendingRequests.length}</b>}</button>)}</nav>
      </aside>
      <section className="ceo-content">
        <div className="ceo-heading"><div><p className="eyebrow">Пульт руководителя</p><h1>{section === "overview" ? "Как идут дела" : section === "journal" ? "Журнал действий" : sectionLabels[section]}</h1>{dataLoading && hasLoaded && <span className="ceo-sync">Синхронизация…</span>}</div>
          {section === "teams" && <button type="button" className="admin-create-button" onClick={() => setTeamDraft({ name: "", description: "", isActive: true })}><span aria-hidden="true">+</span>Создать команду</button>}</div>
        <SectionBoundary key={section} loading={dataLoading && !hasLoaded}>
          {section === "overview" && <CeoOverview teams={teams} users={users} requests={pendingRequests} stats={stats} journal={journal.entries} onNavigate={navigate} onOpenTeam={setOpenTeamId} />}
          {section === "teams" && <CeoTeamsView teams={teams} users={users} stats={stats} onOpen={(team) => setOpenTeamId(team.id)} onEdit={editTeam} onToggle={toggleTeam} onDelete={requestDeleteTeam} actionId={actionId} />}
          {section === "requests" && <RequestsView requests={requests} onResolve={resolveRequest} actionId={actionId} />}
          {section === "users" && <CeoUsersView users={users} teams={teams} stats={stats} onOpen={(user) => setOpenUserId(user.id)} />}
          {section === "journal" && <CeoJournalView teams={teams} entries={journal.entries} hasMore={journal.hasMore} loading={journal.loading} failed={journal.failed} onMore={() => void loadJournalPage(setJournal, journal.entries.at(-1)?.id)} onRetry={() => void loadJournalPage(setJournal)} />}
        </SectionBoundary>
      </section>
    </div>
    <nav className="ceo-mobile-nav" aria-label="Разделы">{mobileSections.map((item) => <button key={item} className={section === item ? "active" : ""} aria-current={section === item ? "page" : undefined} onClick={() => navigate(item)}><span>{ceoIcons[item]}</span>{sectionLabels[item]}{item === "requests" && pendingRequests.length > 0 && <b>{pendingRequests.length}</b>}</button>)}</nav>
    {openTeam && <CeoTeamSheet team={openTeam} users={users} stats={stats} onClose={() => setOpenTeamId("")} onEdit={editTeam} onToggle={toggleTeam} onDelete={requestDeleteTeam} actionId={actionId} />}
    {openUser && <CeoUserSheet user={openUser} users={users} teams={teams} stats={stats} onClose={() => setOpenUserId("")} deleting={actionId === `delete-user:${openUser.id}`}
      onEdit={(user) => setUserDraft({ id: user.id, role: user.role === "admin" ? "admin" : "member", teamId: user.teamId || "" })} onDelete={requestDeleteUser} />}
    {teamDraft && <TeamModal draft={teamDraft} setDraft={setTeamDraft} onSubmit={saveTeam} pending={actionId === "team"} onClose={() => setTeamDraft(null)} />}
    {userDraft && <UserModal draft={userDraft} setDraft={setUserDraft} users={users} teams={teams} onSubmit={saveUserAccess} pending={actionId === userDraft.id} onClose={() => setUserDraft(null)} />}
    {deleteTarget?.type === "team" && <ConfirmModal title="Удалить команду?" description={<>Команда «{deleteTarget.item.name}», её задания, программы, объявления, заявки и рейтинги будут удалены без возможности восстановления.</>} confirmLabel="Удалить команду" busy={actionId === `delete-team:${deleteTarget.item.id}`} onClose={() => setDeleteTarget(null)} onConfirm={() => { void permanentlyDeleteTeam(deleteTarget.item); }} />}
    {deleteTarget?.type === "user" && <ConfirmModal title="Удалить пользователя?" description={<>Профиль «{deleteTarget.item.name}», его работы, звёзды и история будут удалены без восстановления.<br />{deleteImpact ? <>Также будут удалены материалы его ветки: заданий — {deleteImpact.tasks}, программ — {deleteImpact.programs}, объявлений — {deleteImpact.announcements}. Ответов других участников к ним — {deleteImpact.otherSubmissions}. Прямых подопечных — {deleteImpact.children}; их аккаунты сохранятся {deleteTarget.item.parentUserId ? "и перейдут к вышестоящему наставнику" : "как самостоятельные ветки"}.</> : deleteImpactError || "Проверяем связанные данные..."}</>} confirmLabel="Удалить пользователя" busy={actionId === `delete-user:${deleteTarget.item.id}`} confirmDisabled={!deleteImpact} onClose={() => setDeleteTarget(null)} onConfirm={() => { void permanentlyDeleteUser(deleteTarget.item); }} />}
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
    <PullToRefresh onRefresh={() => refresh(true)} />
  </main>;
}

function RequestsView({ requests, onResolve, actionId }: { requests: TeamJoinRequest[]; onResolve: (request: TeamJoinRequest, status: "approved" | "rejected") => void; actionId: string }) {
  return <div className="ceo-panel ceo-request-panel"><div className="ceo-panel-title"><div><p className="eyebrow">Доступ в команды</p><h2>Заявки пользователей</h2></div><span className="ceo-count-label">{requests.filter((request) => request.status === "pending").length} новых</span></div>{requests.length === 0 ? <CeoEmpty text="Заявок пока нет." /> : requests.map((request) => <RequestRow key={request.id} request={request} onResolve={onResolve} actionId={actionId} showDate />)}</div>;
}

function RequestRow({ request, onResolve, actionId, showDate = false }: { request: TeamJoinRequest; onResolve: (request: TeamJoinRequest, status: "approved" | "rejected") => void; actionId: string; showDate?: boolean }) {
  const pending = request.status === "pending";
  return <div className="ceo-request-row"><Avatar className="ceo-user-avatar" name={request.userName || "?"} src={request.userAvatarUrl} /><div className="ceo-request-main"><strong>{request.userName || "Пользователь"}</strong><span>хочет в команду <b>{request.teamName || "—"}</b></span>{showDate && <small>{formatDateTime(request.createdAt)}</small>}</div>{pending ? <div className="ceo-request-actions"><button className="button button-success" onClick={() => onResolve(request, "approved")} disabled={actionId === request.id}>Одобрить</button><button className="button button-danger" onClick={() => onResolve(request, "rejected")} disabled={actionId === request.id}>Отклонить</button></div> : <span className={`request-result ${request.status}`}>{request.status === "approved" ? "Одобрена" : "Отклонена"}</span>}</div>;
}

function TeamModal({ draft, setDraft, onSubmit, pending, onClose }: { draft: TeamDraft; setDraft: (draft: TeamDraft | null) => void; onSubmit: (event: FormEvent) => void; pending: boolean; onClose: () => void }) {
  return <FormSheet title={draft.id ? "Изменить команду" : "Новая команда"} busy={pending} submitLabel={draft.id ? "Сохранить" : "Создать команду"} submitDisabled={draft.name.trim().length < 2} onClose={onClose} onSubmit={onSubmit}>
    <label>Название<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Например, Команда А" maxLength={100} autoFocus /></label>
    <label><span className="field-label">Короткое описание <span className="field-hint">необязательно</span></span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Чем занимается команда" rows={4} maxLength={1000} /></label>
    {draft.id && <label className="toggle-row"><span><strong>Команда активна</strong><small>{draft.isActive ? "Участники видят задания и могут подавать заявки" : "Команда скрыта: заявки не принимаются"}</small></span>
      <input type="checkbox" role="switch" className="toggle-switch" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} /></label>}
  </FormSheet>;
}

function UserModal({ draft, setDraft, users, teams, onSubmit, pending, onClose }: { draft: UserDraft; setDraft: (draft: UserDraft | null) => void; users: User[]; teams: Team[]; onSubmit: (event: FormEvent) => void; pending: boolean; onClose: () => void }) {
  const user = users.find((item) => item.id === draft.id);
  return <FormSheet title={`Доступ: ${user?.name || "пользователь"}`} busy={pending} submitLabel="Сохранить доступ" onClose={onClose} onSubmit={onSubmit}
    intro="Роль определяет возможности, команда — где человек работает.">
    <label>Роль<select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as "admin" | "member" })}><option value="member">Участник</option><option value="admin">Наставник</option></select></label>
    <label>Команда<select value={draft.teamId} onChange={(event) => setDraft({ ...draft, teamId: event.target.value })}><option value="">Без команды</option>{teams.filter((team) => team.isActive).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
  </FormSheet>;
}
function CeoEmpty({ text }: { text: string }) { return <div className="ceo-empty"><span>◌</span><p>{text}</p></div>; }
function CeoAccessDenied({ onLogout }: { onLogout: () => void }) { return <main className="admin-login"><div className="admin-login-card"><a className="brand" href="/"><img className="brand-logo" src="/brand/logo.svg" alt="Прокачка" /></a><p className="eyebrow">Доступ ограничен</p><h1>Раздел CEO</h1><p>Эта панель доступна только пользователю с глобальной ролью CEO.</p><button className="primary-button full" onClick={() => { void onLogout(); }}>Выйти</button><a className="back-link" href="/">Вернуться к заданиям</a></div></main>; }
