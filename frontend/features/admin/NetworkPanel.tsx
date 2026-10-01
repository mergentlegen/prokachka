"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AuthUser, NetworkMember } from "@/shared/domain/types";
import { createNetworkInvitation, updateNetworkUser } from "@/frontend/shared/api/network-client";
import { matchesNetworkFilter, NetworkTree, type NetworkFilter } from "@/frontend/shared/NetworkTree";
import type { NetworkSort } from "@/frontend/shared/lib/network-tree";
import { NetworkMemberSettings, type NetworkUserPatch } from "./NetworkMemberSettings";

export function NetworkPanel({ authUser, users, onChange: setUsers, onError }: {
  authUser: AuthUser; users: NetworkMember[]; onChange: Dispatch<SetStateAction<NetworkMember[]>>; onError: (message: string) => void;
}) {
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [busyId, setBusyId] = useState("");
  const saving = useRef(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<NetworkFilter>("all");
  const [sort, setSort] = useState<NetworkSort>("name");
  const canManage = authUser.role === "admin";
  const hasActivity = users.some((user) => user.recentSubmissions !== undefined);
  const hasMiles = users.some((user) => user.points !== undefined);

  useEffect(() => {
    if (!inviteCopied) return;
    const timer = window.setTimeout(() => setInviteCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [inviteCopied]);

  const count = (value: NetworkFilter) => users.filter((user) => matchesNetworkFilter(user, value)).length;
  const summary: Array<[NetworkFilter, string, string, number]> = [
    ["all", "♙", "Участников", users.filter((user) => user.role === "member").length],
    ["mentors", "⌘", "Наставников", count("mentors")],
    ["new", "✦", "Новых за неделю", count("new")],
    hasActivity ? ["inactive", "◔", "Без работ 2+ недели", count("inactive")] : ["unassigned", "↳", "Без закрепления", count("unassigned")],
  ];

  async function save(id: string, input: NetworkUserPatch) {
    if (saving.current) return false;
    saving.current = true;
    setBusyId(id);
    try {
      const saved = await updateNetworkUser(id, input);
      // The update response has no stats; keep the loaded miles and activity.
      setUsers((current) => current.map((user) => user.id === saved.id ? { ...user, ...saved } : user));
      onError("Настройки участника сохранены.");
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось сохранить настройки участника.");
      return false;
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

  return <div className="network-page">
    <div className="admin-panel network-intro">
      <div><p className="eyebrow">Иерархия команды</p><h2>Структура сети</h2><p>Нажмите на человека, чтобы открыть карточку: мили, звёзды, активность{canManage ? " и настройки" : ""}.</p></div>
      <button className="primary-button" disabled={inviteBusy || Boolean(inviteUrl)} onClick={() => void createInvite()}>{inviteUrl ? "Ссылка готова" : inviteBusy ? "Загружаем..." : "Ссылка-приглашение"}</button>
    </div>
    {inviteUrl && <div className="admin-panel network-invite">
      <div className="network-invite-copy"><strong>Одна бессрочная ссылка</strong><small>Используется много раз. Вступление подтверждает наставник.</small></div>
      <input aria-label="Ссылка приглашения" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
      <button className="button button-edit" onClick={() => void copyInvite()}>{inviteCopied ? "Скопировано" : "Копировать"}</button>
    </div>}
    <div className="network-summary-grid">
      {summary.map(([key, icon, label, value]) => <button type="button" key={key} className={`network-summary-card${filter === key && key !== "all" ? " active" : ""}`} aria-pressed={filter === key}
        onClick={() => { setFilter(filter === key ? "all" : key); setQuery(""); }}>
        <span aria-hidden="true">{icon}</span><div><strong>{value}</strong><small>{label}</small></div>
      </button>)}
    </div>
    <div className="admin-panel network-toolbar">
      <label className="network-search-label"><span>Поиск участника</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или логин" /></label>
      <label className="network-filter-label"><span>Показать</span><select value={filter} onChange={(event) => setFilter(event.target.value as NetworkFilter)}>
        <option value="all">Всю структуру</option><option value="mentors">Наставников</option><option value="new">Новых за неделю</option>
        {hasActivity && <option value="inactive">Без работ 2+ недели</option>}<option value="unassigned">Без закрепления</option>
      </select></label>
      {hasMiles && <label className="network-filter-label"><span>Порядок</span><select value={sort} onChange={(event) => setSort(event.target.value as NetworkSort)}>
        <option value="name">По имени</option><option value="miles">Больше миль выше</option>
      </select></label>}
    </div>
    <div className="admin-panel network-list">
      <NetworkTree users={users} currentUserId={authUser.id} query={query} filter={filter} sort={sort} onClearSearch={() => { setQuery(""); setFilter("all"); }}
        renderControls={canManage ? (user) => user.role === "member"
          ? <NetworkMemberSettings key={user.id} user={user} users={users} busy={Boolean(busyId)} onSave={(input) => save(user.id, input)} />
          : null : undefined} />
    </div>
  </div>;
}
