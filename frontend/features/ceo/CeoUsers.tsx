"use client";

import { useState } from "react";
import type { Team, User, UserRole } from "@/shared/domain/types";
import type { CeoStats } from "@/frontend/shared/api/ceo-client";
import { Avatar } from "@/frontend/shared/Avatar";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { formatDate, milesUnit } from "@/frontend/shared/lib/format";
import { plural } from "@/frontend/shared/lib/plural";
import styles from "./CeoUsers.module.css";

export const roleLabels: Record<UserRole, string> = { ceo: "CEO", admin: "Наставник", member: "Участник" };
type Filter = "all" | "mentors" | "members" | "noTeam" | "noTelegram";

export function filterCeoUsers(users: User[], stats: CeoStats | null, { query, filter, teamId }: { query: string; filter: Filter; teamId: string }) {
  const search = query.trim().toLocaleLowerCase("ru");
  return users.filter((user) => {
    if (search && !`${user.name} ${user.login || ""}`.toLocaleLowerCase("ru").includes(search)) return false;
    if (teamId && user.teamId !== teamId) return false;
    if (filter === "mentors") return user.role === "admin";
    if (filter === "members") return user.role === "member";
    if (filter === "noTeam") return user.role !== "ceo" && !user.teamId;
    if (filter === "noTelegram") return user.role !== "ceo" && stats?.users[user.id]?.hasTelegram === false;
    return true;
  });
}

export function CeoUsersView({ users, teams, stats, onOpen }: { users: User[]; teams: Team[]; stats: CeoStats | null; onOpen: (user: User) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [teamId, setTeamId] = useState("");
  const shown = filterCeoUsers(users, stats, { query, filter, teamId });
  const teamName = new Map(teams.map((team) => [team.id, team.name]));
  const count = (value: Filter) => filterCeoUsers(users, stats, { query: "", filter: value, teamId: "" }).length;
  const chips: Array<[Filter, string]> = [["all", "Все"], ["mentors", "Наставники"], ["members", "Участники"], ["noTeam", "Без команды"], ...(stats ? [["noTelegram", "Без Telegram"] as [Filter, string]] : [])];
  return <div className={styles.panel}>
    <div className={styles.tools}>
      <label className={styles.search}><span>Поиск пользователя</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или логин" /></label>
      <label className={styles.team}><span>Команда</span><select value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="">Все команды</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
    </div>
    <div className={styles.chips} role="group" aria-label="Показать">{chips.map(([id, label]) => <button type="button" key={id} className={filter === id ? styles.active : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<b>{count(id)}</b></button>)}</div>
    <p className={styles.count}>Показано {shown.length} из {users.length}</p>
    {shown.length === 0 ? <p className={styles.empty}>Никого не нашли. Измените поиск или фильтр.</p> : <ul className={styles.list}>{shown.map((user) => <li key={user.id}>
      <button type="button" onClick={() => onOpen(user)}>
        <Avatar className={styles.avatar} name={user.name} src={user.avatarUrl} />
        <span className={styles.main}><strong>{user.name}</strong><small>{user.login || "логин не указан"} · {user.teamId ? teamName.get(user.teamId) || "Команда" : "Без команды"}</small></span>
        <em className={`${styles.role} ${styles[user.role]}`}>{roleLabels[user.role]}</em>
      </button>
    </li>)}</ul>}
  </div>;
}

export function CeoUserSheet({ user, users, teams, stats, onClose, onEdit, onDelete, deleting }: {
  user: User; users: User[]; teams: Team[]; stats: CeoStats | null; onClose: () => void; onEdit: (user: User) => void; onDelete: (user: User) => void; deleting: boolean;
}) {
  const item = stats?.users[user.id];
  const leader = user.parentUserId ? users.find((candidate) => candidate.id === user.parentUserId) : undefined;
  const team = teams.find((entry) => entry.id === user.teamId);
  const canManage = user.role !== "ceo";
  return <ModalSheet title={user.name} onClose={onClose} footer={canManage ? <>
    <button type="button" className="button button-outline-danger" onClick={() => onDelete(user)} disabled={deleting}>Удалить</button>
    <button type="button" className="button button-primary" onClick={() => onEdit(user)}>Изменить доступ</button>
  </> : undefined}>
    <div className={styles.sheet}>
      <div className={styles.identity}><Avatar className={styles.bigAvatar} name={user.name} src={user.avatarUrl} eager /><div><strong>{user.name}</strong><small>{user.login || "логин не указан"}</small><em className={`${styles.role} ${styles[user.role]}`}>{roleLabels[user.role]}</em></div></div>
      {item && user.role !== "ceo" && <div className={styles.stats}>
        <div><strong>{item.miles}</strong><small>{milesUnit(item.miles)}</small></div>
        <div><strong>{item.stars}</strong><small>{plural(item.stars, "звезда", "звезды", "звёзд")}</small></div>
        <div><strong>{item.works90}</strong><small>{plural(item.works90, "работа", "работы", "работ")} за 90 дней</small></div>
      </div>}
      <dl className={styles.facts}>
        <div><dt>Команда</dt><dd>{team?.name || "Без команды"}</dd></div>
        {leader && <div><dt>Руководитель</dt><dd>{leader.name}</dd></div>}
        <div><dt>Регистрация</dt><dd>{formatDate(user.createdAt)}</dd></div>
        {user.teamJoinedAt && <div><dt>В команде с</dt><dd>{formatDate(user.teamJoinedAt)}</dd></div>}
        {item && user.role !== "ceo" && <div><dt>Последняя работа</dt><dd>{item.lastSubmittedAt ? formatDate(item.lastSubmittedAt) : "За 90 дней работ не было"}</dd></div>}
        {item && user.role !== "ceo" && <div><dt>Telegram</dt><dd className={item.hasTelegram ? styles.ok : styles.warn}>{item.hasTelegram ? "Подключён" : "Не подключён — уведомления не приходят"}</dd></div>}
      </dl>
    </div>
  </ModalSheet>;
}
