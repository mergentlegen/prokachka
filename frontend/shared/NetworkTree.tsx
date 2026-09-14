"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { User } from "@/shared/domain/types";
import { buildNetworkTree, visibleNetworkEntries } from "./lib/network-tree";
import styles from "./NetworkTree.module.css";

export function NetworkTree({ users, currentUserId, query = "", filter = "all", renderControls }: {
  users: User[]; currentUserId: string; query?: string; filter?: "all" | "mentors" | "unassigned";
  renderControls?: (user: User) => ReactNode;
}) {
  const entries = useMemo(() => buildNetworkTree(users), [users]);
  const byId = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const search = query.trim().toLocaleLowerCase("ru");
  const searching = Boolean(search) || filter !== "all";
  const visible = searching ? entries.filter(({ user }) =>
    `${user.name} ${user.login || ""}`.toLocaleLowerCase("ru").includes(search) &&
    (filter === "all" || (filter === "mentors" && (user.role === "admin" || user.canReview || user.canPublishTasks)) || (filter === "unassigned" && user.role === "member" && !user.parentUserId))
  ) : visibleNetworkEntries(entries, collapsed);

  return <div className={styles.tree}>
    <div className={styles.toolbar}><span aria-live="polite">Показано: {visible.length} из {users.length}</span>{!searching && entries.some((entry) => entry.childCount > 0) && <button type="button" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(entries.filter((entry) => entry.childCount > 0).map((entry) => entry.user.id)))}>{collapsed.size ? "Развернуть ветки" : "Свернуть ветки"}</button>}</div>
    {visible.length === 0 ? <div className="empty-admin"><p>{users.length ? "Участники не найдены." : "В сети пока нет участников."}</p></div> : <ul className={styles.list}>
      {visible.map(({ user, depth, childCount, descendantCount }) => {
        const parent = user.parentUserId ? byId.get(user.parentUserId) : undefined;
        return <li className={styles.row} key={user.id} style={{ "--tree-indent": `${searching ? 0 : Math.min(depth, 3) * 12}px` } as CSSProperties}>
          <div className={styles.person}>
            {childCount > 0 && !searching ? <button type="button" className={styles.toggle} aria-label={`${collapsed.has(user.id) ? "Развернуть" : "Свернуть"} ветку ${user.name}`} aria-expanded={!collapsed.has(user.id)} onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(user.id)) next.delete(user.id); else next.add(user.id); return next; })}>{collapsed.has(user.id) ? "›" : "⌄"}</button> : <span className={styles.leaf} aria-hidden="true">{depth ? "↳" : "•"}</span>}
            <span className="rank-avatar" aria-hidden="true">{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
            <div className={styles.copy}><strong>{user.name}{user.id === currentUserId && <em>Вы</em>}</strong><small>{parent ? `В ветке: ${parent.name}` : user.role === "admin" ? "Руководитель команды" : user.parentUserId ? "Начало доступной вам ветки" : "Без закрепления"}</small><div className={styles.meta}><span>Уровень {depth + 1}</span>{descendantCount > 0 && <span>В сети: {descendantCount}</span>}{user.canReview && <span>Проверяет</span>}{user.canPublishTasks && <span>Публикует</span>}</div></div>
          </div>
          {renderControls && user.role === "member" && <ParticipantSettings user={user} renderControls={renderControls} />}
        </li>;
      })}
    </ul>}
  </div>;
}

function ParticipantSettings({ user, renderControls }: { user: User; renderControls: (user: User) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className={styles.settings} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Настройки участника</summary>
    {open && <div>{renderControls(user)}</div>}
  </details>;
}
