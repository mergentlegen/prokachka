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
  const [busyId, setBusyId] = useState("");
  const canManage = authUser.role === "admin";

  async function refresh() {
    try { setUsers(await loadNetwork()); } catch { onError("Не удалось загрузить структуру сети."); } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const orderedUsers = useMemo(() => [...users].sort((a, b) => getDepth(users, a) - getDepth(users, b) || a.name.localeCompare(b.name)), [users]);

  async function save(id: string, input: { parentUserId?: string | null; canReview?: boolean; canPublishTasks?: boolean }) {
    setBusyId(id);
    try { const saved = await updateNetworkUser(id, input); setUsers((current) => current.map((user) => user.id === saved.id ? saved : user)); }
    catch { onError("Не удалось сохранить настройки участника."); }
    finally { setBusyId(""); }
  }

  async function createInvite() {
    try { const result = await createNetworkInvitation(); setInviteUrl(result.url); await navigator.clipboard?.writeText(result.url); }
    catch { onError("Не удалось создать ссылку приглашения."); }
  }

  if (loading) return <div className="admin-panel"><p>Загружаем структуру сети...</p></div>;
  return <div className="network-page">
    <div className="admin-panel network-intro"><div><p className="eyebrow">Иерархия команды</p><h2>Структура сети</h2><p>Здесь можно закреплять участников за наставниками и выдавать права проверки и публикации. Ссылка приглашения доступна каждому участнику автоматически.</p></div><button className="primary-button" onClick={() => { void createInvite(); }}>{inviteUrl ? "Создать новую ссылку" : "Создать ссылку"}</button></div>
    {inviteUrl && <div className="admin-panel network-invite"><strong>Многоразовая ссылка готова</strong><input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /><button className="button button-edit" onClick={() => void navigator.clipboard?.writeText(inviteUrl)}>Копировать</button><small>Ссылка бессрочная и требует подтверждения наставником.</small></div>}
    <div className="admin-panel network-list">{orderedUsers.length === 0 ? <p>В команде пока нет участников.</p> : orderedUsers.map((user) => <div className="network-row" key={user.id} style={{ "--network-depth": getDepth(users, user) } as React.CSSProperties}>
      <div className="network-person"><span className="rank-avatar">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.login || "Участник"}</small></div></div>
      {canManage && user.role === "member" ? <><label className="network-select-label">Закреплён за<select value={user.parentUserId || ""} disabled={busyId === user.id} onChange={(event) => void save(user.id, { parentUserId: event.target.value || null })}><option value="">Без руководителя</option>{users.filter((parent) => parent.id !== user.id).map((parent) => <option value={parent.id} key={parent.id}>{parent.name}</option>)}</select></label><div className="network-permissions"><label><input type="checkbox" checked={Boolean(user.canReview)} disabled={busyId === user.id} onChange={(event) => void save(user.id, { canReview: event.target.checked })} /> Проверяет</label><label><input type="checkbox" checked={Boolean(user.canPublishTasks)} disabled={busyId === user.id} onChange={(event) => void save(user.id, { canPublishTasks: event.target.checked })} /> Публикует</label></div></> : <span className="network-role-note">{user.role === "admin" ? "Руководитель команды" : "Ваша сеть"}</span>}
    </div>)}</div>
  </div>;
}
