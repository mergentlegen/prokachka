"use client";

import { useEffect, useMemo, useState } from "react";
import type { AuthUser, User } from "@/shared/domain/types";
import { createNetworkInvitation, loadNetwork, updateNetworkUser } from "@/frontend/shared/api/network-client";

function getDepth(users: User[], user: User) {
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

export function NetworkPanel({ authUser, onError }: { authUser: AuthUser; onError: (message: string) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "mentors" | "unassigned">("all");
  const canManage = authUser.role === "admin";

  async function refresh() {
    try { setUsers(await loadNetwork()); } catch { onError("Не удалось загрузить структуру сети."); } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const orderedUsers = useMemo(() => [...users].sort((a, b) => getDepth(users, a) - getDepth(users, b) || a.name.localeCompare(b.name)), [users]);
  const visibleUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return orderedUsers.filter((user) => {
      const matchesQuery = !normalizedQuery || `${user.name} ${user.login || ""}`.toLocaleLowerCase().includes(normalizedQuery);
      const matchesFilter = filter === "all" || (filter === "mentors" && (user.canReview || user.canPublishTasks)) || (filter === "unassigned" && user.role === "member" && !user.parentUserId);
      return matchesQuery && matchesFilter;
    });
  }, [filter, orderedUsers, query]);
  const mentorCount = users.filter((user) => user.role === "member" && (user.canReview || user.canPublishTasks)).length;
  const unassignedCount = users.filter((user) => user.role === "member" && !user.parentUserId).length;

  async function save(id: string, input: { parentUserId?: string | null; canReview?: boolean; canPublishTasks?: boolean }) {
    setBusyId(id);
    try { const saved = await updateNetworkUser(id, input); setUsers((current) => current.map((user) => user.id === saved.id ? saved : user)); }
    catch { onError("Не удалось сохранить настройки участника."); }
    finally { setBusyId(""); }
  }

  async function createInvite() {
    try { const result = await createNetworkInvitation(); setInviteUrl(result.url); }
    catch { onError("Не удалось создать ссылку приглашения."); }
  }

  async function copyInvite() {
    if (!inviteUrl || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1800);
    } catch { onError("Не удалось скопировать ссылку."); }
  }

  if (loading) return <div className="admin-panel"><p>Загружаем структуру сети...</p></div>;
  return <div className="network-page">
    <div className="admin-panel network-intro"><div><p className="eyebrow">Иерархия команды</p><h2>Структура сети</h2><p>Вложенность показывает путь участника в команде. Участник может быть закреплён за наставником, который проверяет его работы или публикует задания для своей ветки.</p></div><button className="primary-button" disabled={Boolean(inviteUrl)} onClick={() => { void createInvite(); }}>{inviteUrl ? "Ссылка готова" : "Получить ссылку"}</button></div>
    <div className="network-summary-grid"><div className="network-summary-card"><span>♙</span><div><strong>{users.filter((user) => user.role === "member").length}</strong><small>Участников</small></div></div><div className="network-summary-card"><span>⌘</span><div><strong>{mentorCount}</strong><small>Наставников</small></div></div><div className="network-summary-card"><span>↳</span><div><strong>{unassignedCount}</strong><small>Без закрепления</small></div></div></div>
    {inviteUrl && <div className="admin-panel network-invite"><div className="network-invite-copy"><strong>Одна бессрочная ссылка</strong><small>Используется много раз. Вступление подтверждает наставник.</small></div><input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /><button className="button button-edit" onClick={() => { void copyInvite(); }}>{inviteCopied ? "Скопировано" : "Копировать"}</button></div>}
    <div className="admin-panel network-toolbar"><label className="network-search-label"><span>Поиск участника</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или логин" /></label><label className="network-filter-label"><span>Показать</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Всю структуру</option><option value="mentors">Наставников</option><option value="unassigned">Без закрепления</option></select></label></div>
    <div className="admin-panel network-list"><div className="network-list-heading"><div><p className="eyebrow">Карта команды</p><h3>Участники по уровням</h3></div><span>{visibleUsers.length} из {orderedUsers.length}</span></div>{visibleUsers.length === 0 ? <div className="empty-admin"><span>⌕</span><p>{orderedUsers.length === 0 ? "В команде пока нет участников." : "По этому фильтру участников нет."}</p></div> : visibleUsers.map((user) => <div className="network-row" key={user.id} style={{ "--network-depth": getDepth(users, user) } as React.CSSProperties}>
      <div className="network-person"><span className="network-tree-line" aria-hidden="true">{getDepth(users, user) > 0 ? "↳" : "•"}</span><span className="rank-avatar">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.login || "Участник"}</small></div></div>
      {canManage && user.role === "member" ? <><label className="network-select-label">Закреплён за<select value={user.parentUserId || ""} disabled={busyId === user.id} onChange={(event) => void save(user.id, { parentUserId: event.target.value || null })}><option value="">Без руководителя</option>{users.filter((parent) => parent.id !== user.id).map((parent) => <option value={parent.id} key={parent.id}>{parent.name}</option>)}</select></label><div className="network-permissions"><label><input type="checkbox" checked={Boolean(user.canReview)} disabled={busyId === user.id} onChange={(event) => void save(user.id, { canReview: event.target.checked })} /> Проверяет</label><label><input type="checkbox" checked={Boolean(user.canPublishTasks)} disabled={busyId === user.id} onChange={(event) => void save(user.id, { canPublishTasks: event.target.checked })} /> Публикует</label></div></> : <span className="network-role-note">{user.role === "admin" ? "Руководитель команды" : "Участник сети"}</span>}
    </div>)}</div>
  </div>;
}
