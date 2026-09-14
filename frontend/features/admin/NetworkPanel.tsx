"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AuthUser, User } from "@/shared/domain/types";
import { createNetworkInvitation, loadNetwork, updateNetworkUser } from "@/frontend/shared/api/network-client";
import { NetworkTree } from "@/frontend/shared/NetworkTree";
import { buildNetworkTree, networkDescendantIds } from "@/frontend/shared/lib/network-tree";

export function NetworkPanel({ authUser, onError }: { authUser: AuthUser; onError: (message: string) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [busyId, setBusyId] = useState("");
  const saving = useRef(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "mentors" | "unassigned">("all");
  const canManage = authUser.role === "admin";
  const entries = useMemo(() => buildNetworkTree(users), [users]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    loadNetwork().then((data) => { if (!cancelled) setUsers(data); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retry]);

  useEffect(() => {
    if (!inviteCopied) return;
    const timer = window.setTimeout(() => setInviteCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [inviteCopied]);

  const mentorCount = users.filter((user) => user.role === "admin" || user.canReview || user.canPublishTasks).length;
  const unassignedCount = users.filter((user) => user.role === "member" && !user.parentUserId).length;

  async function save(id: string, input: { parentUserId?: string | null; canReview?: boolean; canPublishTasks?: boolean }) {
    if (saving.current) return;
    saving.current = true;
    setBusyId(id);
    try {
      const saved = await updateNetworkUser(id, input);
      setUsers((current) => current.map((user) => user.id === saved.id ? saved : user));
      onError("Настройки участника сохранены.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось сохранить настройки участника.");
    } finally { saving.current = false; setBusyId(""); }
  }

  async function createInvite() {
    if (inviteBusy || inviteUrl) return;
    setInviteBusy(true);
    try { const result = await createNetworkInvitation(); setInviteUrl(result.url); }
    catch { onError("Не удалось получить ссылку приглашения."); }
    finally { setInviteBusy(false); }
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopied(true);
      onError("Скопировано");
    } catch { onError("Не удалось скопировать ссылку. Выделите её и скопируйте вручную."); }
  }

  if (loading) return <div className="admin-panel network-intro" role="status"><p>Загружаем структуру сети...</p></div>;
  if (failed) return <div className="admin-panel network-intro"><p role="alert">Не удалось загрузить структуру сети.</p><button className="button button-edit" onClick={() => setRetry((value) => value + 1)}>Повторить</button></div>;

  return <div className="network-page">
    <div className="admin-panel network-intro">
      <div><p className="eyebrow">Иерархия команды</p><h2>Структура сети</h2><p>Откройте ветку стрелкой рядом с именем. Под каждым участником указан его руководитель, а счётчик показывает всю его нижнюю сеть. Уровни считаются от начала доступной вам структуры.</p></div>
      <button className="primary-button" disabled={inviteBusy || Boolean(inviteUrl)} onClick={() => void createInvite()}>{inviteUrl ? "Ссылка готова" : inviteBusy ? "Загружаем..." : "Получить ссылку"}</button>
    </div>
    <div className="network-summary-grid">
      <div className="network-summary-card"><span>♙</span><div><strong>{users.filter((user) => user.role === "member").length}</strong><small>Участников</small></div></div>
      <div className="network-summary-card"><span>⌘</span><div><strong>{mentorCount}</strong><small>Наставников</small></div></div>
      <div className="network-summary-card"><span>↳</span><div><strong>{unassignedCount}</strong><small>Без закрепления</small></div></div>
    </div>
    {inviteUrl && <div className="admin-panel network-invite">
      <div className="network-invite-copy"><strong>Одна бессрочная ссылка</strong><small>Используется много раз. Вступление подтверждает наставник.</small></div>
      <input aria-label="Ссылка приглашения" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
      <button className="button button-edit" onClick={() => void copyInvite()}>{inviteCopied ? "Скопировано" : "Копировать"}</button>
    </div>}
    <div className="admin-panel network-toolbar">
      <label className="network-search-label"><span>Поиск участника</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или логин" /></label>
      <label className="network-filter-label"><span>Показать</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Всю структуру</option><option value="mentors">Наставников</option><option value="unassigned">Без закрепления</option></select></label>
    </div>
    <div className="admin-panel network-list">
      <div className="network-list-heading"><div><p className="eyebrow">Карта команды</p><h3>Участники по веткам</h3></div><span role="status">{busyId ? "Сохраняем..." : ""}</span></div>
      <NetworkTree users={users} currentUserId={authUser.id} query={query} filter={filter} renderControls={canManage ? (user) => {
        if (user.role !== "member") return null;
        const excluded = networkDescendantIds(entries, user.id);
        return <>
          <label className="network-select-label">Закреплён за
            <select value={user.parentUserId || ""} disabled={Boolean(busyId)} onChange={(event) => void save(user.id, { parentUserId: event.target.value || null })}>
              <option value="">Без руководителя</option>
              {users.filter((parent) => !excluded.has(parent.id)).map((parent) => <option value={parent.id} key={parent.id}>{parent.name}</option>)}
            </select>
          </label>
          <div className="network-permissions">
            <label><input type="checkbox" checked={Boolean(user.canReview)} disabled={Boolean(busyId)} onChange={(event) => void save(user.id, { canReview: event.target.checked })} />Проверяет работы</label>
            <label><input type="checkbox" checked={Boolean(user.canPublishTasks)} disabled={Boolean(busyId)} onChange={(event) => void save(user.id, { canPublishTasks: event.target.checked })} />Публикует задания</label>
          </div>
        </>;
      } : undefined} />
    </div>
  </div>;
}
