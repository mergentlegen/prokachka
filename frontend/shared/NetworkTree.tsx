"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import type { CSSProperties, ReactNode } from "react";
import type { NetworkMember } from "@/shared/domain/types";
import { buildNetworkTree, isNewMember, networkActivity, networkAncestors, visibleNetworkEntries, type NetworkActivity, type NetworkEntry, type NetworkSort } from "./lib/network-tree";
import { NetworkPersonCard } from "./NetworkPersonCard";
import { milesUnit } from "./lib/format";
import styles from "./NetworkTree.module.css";

export type NetworkFilter = "all" | "mentors" | "unassigned" | "new" | "inactive";

export const activityLabels: Record<NetworkActivity, string> = { active: "Сдаёт работы", quiet: "Нет работ больше 2 недель", inactive: "Нет работ 30 дней" };

const isMentor = (user: NetworkMember) => user.role === "admin" || Boolean(user.canReview || user.canPublishTasks);

export function matchesNetworkFilter(user: NetworkMember, filter: NetworkFilter) {
  if (filter === "mentors") return isMentor(user);
  if (filter === "unassigned") return user.role === "member" && !user.parentUserId;
  if (filter === "new") return isNewMember(user);
  if (filter === "inactive") { const activity = networkActivity(user); return activity === "quiet" || activity === "inactive"; }
  return true;
}

export function lineLabel(depth: number) { return `${depth}-я линия`; }

export function NetworkTree({ users, currentUserId, query = "", filter = "all", sort = "name", onClearSearch, renderControls }: {
  users: NetworkMember[]; currentUserId: string; query?: string; filter?: NetworkFilter; sort?: NetworkSort;
  onClearSearch?: () => void; renderControls?: (user: NetworkMember) => ReactNode;
}) {
  const entries = useMemo(() => buildNetworkTree(users, sort), [users, sort]);
  const byId = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.user.id, entry])), [entries]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState("");
  const [highlightId, setHighlightId] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const search = query.trim().toLocaleLowerCase("ru");
  const searching = Boolean(search) || filter !== "all";
  const visible = searching
    ? entries.filter(({ user }) => `${user.name} ${user.login || ""}`.toLocaleLowerCase("ru").includes(search) && matchesNetworkFilter(user, filter))
    : visibleNetworkEntries(entries, collapsed);
  const openEntry = openId ? entryById.get(openId) : undefined;

  useEffect(() => {
    if (!highlightId || searching) return;
    list.current?.querySelector(`[data-network-row="${CSS.escape(highlightId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => setHighlightId(""), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightId, searching]);

  function toggle(id: string) {
    setCollapsed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function reveal(user: NetworkMember) {
    const ancestors = networkAncestors(byId, user);
    setCollapsed((current) => { const next = new Set(current); ancestors.forEach((parent) => next.delete(parent.id)); return next; });
    setOpenId("");
    setHighlightId(user.id);
    onClearSearch?.();
  }

  const branchIds = entries.filter((entry) => entry.childCount > 0).map((entry) => entry.user.id);
  return <div className={styles.tree}>
    <div className={styles.toolbar}>
      <span aria-live="polite">Показано: {visible.length} из {users.length}</span>
      {!searching && branchIds.length > 0 && <button type="button" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(branchIds))}>{collapsed.size ? "Развернуть все ветки" : "Свернуть все ветки"}</button>}
    </div>
    {visible.length === 0 ? <div className={styles.empty}><p>{users.length ? "Никого не нашли. Попробуйте другое имя или фильтр." : "В сети пока нет участников."}</p></div> : <ul className={styles.list} ref={list}>
      {visible.map((entry) => <NetworkRow key={entry.user.id} entry={entry} byId={byId} currentUserId={currentUserId} searching={searching}
        collapsed={collapsed.has(entry.user.id)} highlighted={highlightId === entry.user.id} onToggle={() => toggle(entry.user.id)} onOpen={() => setOpenId(entry.user.id)} />)}
    </ul>}
    {openEntry && <NetworkPersonCard entry={openEntry} byId={byId} currentUserId={currentUserId} canReveal={searching || networkAncestors(byId, openEntry.user).some((parent) => collapsed.has(parent.id))}
      onReveal={() => reveal(openEntry.user)} onClose={() => setOpenId("")} controls={renderControls?.(openEntry.user)} />}
  </div>;
}

function NetworkRow({ entry, byId, currentUserId, searching, collapsed, highlighted, onToggle, onOpen }: {
  entry: NetworkEntry<NetworkMember>; byId: ReadonlyMap<string, NetworkMember>; currentUserId: string; searching: boolean;
  collapsed: boolean; highlighted: boolean; onToggle: () => void; onOpen: () => void;
}) {
  const { user, depth, childCount, descendantCount } = entry;
  const activity = networkActivity(user);
  const level = searching ? 0 : depth;
  const subtitle = searching
    ? networkAncestors(byId, user).map((parent) => parent.name).join(" → ") || rootLabel(user, currentUserId)
    : depth ? [lineLabel(depth), descendantCount ? `в сети ${descendantCount}` : ""].filter(Boolean).join(" · ") : rootLabel(user, currentUserId);
  return <li className={`${styles.row} ${highlighted ? styles.highlighted : ""}`} data-network-row={user.id}
    style={{ "--guides": Math.min(level, 4), "--deep": level > 4 ? 1 : 0 } as CSSProperties}>
    {level > 0 && <span className={styles.guides} aria-hidden="true" />}
    {childCount > 0 && !searching
      ? <button type="button" className={styles.toggle} aria-label={`${collapsed ? "Развернуть" : "Свернуть"} ветку ${user.name}`} aria-expanded={!collapsed} onClick={onToggle}><span className={`${styles.chevron} ${collapsed ? styles.closed : ""}`} aria-hidden="true" />{collapsed && <b>{descendantCount}</b>}</button>
      : <span className={styles.leaf} aria-hidden="true" />}
    <button type="button" className={styles.person} onClick={onOpen} aria-label={`Открыть карточку: ${user.name}`}>
      <span className={styles.avatar}>
        <Avatar className="rank-avatar" name={user.name} src={user.avatarUrl} />
        {activity && <i className={`${styles.dot} ${styles[activity]}`} title={activityLabels[activity]} />}
      </span>
      <span className={styles.copy}>
        <strong>{user.name}{user.id === currentUserId && <em className={styles.you}>Вы</em>}{isNewMember(user) && <em className={styles.new}>Новый</em>}</strong>
        <small>{subtitle}</small>
        {activity && activity !== "active" && <small className={styles.activityText}>{activityLabels[activity]}</small>}
      </span>
      <NetworkScore user={user} />
    </button>
  </li>;
}

export function rootLabel(user: NetworkMember, currentUserId: string) {
  if (user.role === "admin") return "Руководитель команды";
  if (user.id === currentUserId) return "Начало ветки";
  return user.parentUserId ? "Начало доступной ветки" : "Без закрепления";
}

function NetworkScore({ user }: { user: NetworkMember }) {
  if (user.points === undefined && user.stars === undefined) return null;
  const points = user.points ?? 0;
  return <span className={styles.score} aria-label={`${points} ${milesUnit(points)}, звёзд: ${user.stars ?? 0}`}>
    <b>{user.points ?? "—"}</b><small>{milesUnit(points)}</small>
    {Boolean(user.stars) && <span className={styles.stars}>★ {user.stars}</span>}
  </span>;
}
