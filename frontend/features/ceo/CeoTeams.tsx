"use client";

import type { Team, User } from "@/shared/domain/types";
import type { CeoStats } from "@/frontend/shared/api/ceo-client";
import { Avatar } from "@/frontend/shared/Avatar";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { formatDate } from "@/frontend/shared/lib/format";
import { plural } from "@/frontend/shared/lib/plural";
import { formatHours, teamHealth } from "./ceo-insights";
import { healthLabels } from "./CeoOverview";
import styles from "./CeoTeams.module.css";

type TeamActions = { onOpen: (team: Team) => void; onEdit: (team: Team) => void; onToggle: (team: Team) => void; onDelete: (team: Team) => void; actionId: string };

export function CeoTeamsView({ teams, users, stats, onOpen, onEdit, onToggle, onDelete, actionId }: { teams: Team[]; users: User[]; stats: CeoStats | null } & TeamActions) {
  if (teams.length === 0) return <div className={styles.emptyState}><strong>Команд пока нет</strong><p>Создайте первую команду, чтобы участники могли подать заявку.</p></div>;
  const byTeam = new Map((stats?.teams || []).map((item) => [item.teamId, item]));
  return <div className={styles.grid}>{teams.map((team) => {
    const people = users.filter((user) => user.teamId === team.id);
    const mentors = people.filter((user) => user.role === "admin");
    const item = byTeam.get(team.id);
    const health = team.isActive ? teamHealth(item) : null;
    return <article className={`${styles.card} ${team.isActive ? "" : styles.off}`} key={team.id}>
      <button type="button" className={styles.open} onClick={() => onOpen(team)} aria-label={`Подробнее о команде ${team.name}`}>
        <span className={styles.top}><strong>{team.name}</strong>{health ? <em className={styles[health]}>{healthLabels[health]}</em> : <em className={styles.disabled}>Отключена</em>}</span>
        <span className={styles.description}>{team.description || "Описание пока не добавлено."}</span>
        <span className={styles.numbers}>
          <span><b>{people.filter((user) => user.role === "member").length}</b> {plural(people.filter((user) => user.role === "member").length, "участник", "участника", "участников")}</span>
          <span><b>{mentors.length}</b> {plural(mentors.length, "наставник", "наставника", "наставников")}</span>
          {item && <span><b>{item.submissions7}</b> работ за неделю</span>}
        </span>
        {mentors.length === 0 && team.isActive && <span className={styles.warning}>Нет наставника — работы некому проверять</span>}
      </button>
      <div className={styles.actions}>
        <button type="button" className="button button-edit" onClick={() => onEdit(team)}>Изменить</button>
        <button type="button" className={"button " + (team.isActive ? "button-warning" : "button-success")} onClick={() => onToggle(team)} disabled={actionId === team.id}>{team.isActive ? "Отключить" : "Включить"}</button>
        <button type="button" className="button button-danger" onClick={() => onDelete(team)} disabled={actionId === `delete-team:${team.id}`}>Удалить</button>
      </div>
    </article>;
  })}</div>;
}

export function CeoTeamSheet({ team, users, stats, onClose, onEdit, onToggle, onDelete, actionId }: { team: Team; users: User[]; stats: CeoStats | null; onClose: () => void } & Omit<TeamActions, "onOpen">) {
  const item = stats?.teams.find((entry) => entry.teamId === team.id);
  const people = users.filter((user) => user.teamId === team.id);
  const mentors = people.filter((user) => user.role === "admin");
  const health = team.isActive ? teamHealth(item) : null;
  return <ModalSheet title={team.name} tall onClose={onClose} footer={<>
    <button type="button" className="button button-outline-danger" onClick={() => onDelete(team)} disabled={actionId === `delete-team:${team.id}`}>Удалить</button>
    <button type="button" className={"button " + (team.isActive ? "button-outline-warning" : "button-success")} onClick={() => onToggle(team)} disabled={actionId === team.id}>{team.isActive ? "Отключить" : "Включить"}</button>
    <button type="button" className="button button-primary" onClick={() => onEdit(team)}>Изменить</button>
  </>}>
    <div className={styles.sheet}>
      <p className={styles.sheetMeta}>{health ? <em className={styles[health]}>{healthLabels[health]}</em> : <em className={styles.disabled}>Отключена</em>} Создана {formatDate(team.createdAt)}</p>
      {team.description && <p className={styles.sheetText}>{team.description}</p>}
      <div className={styles.stats}>
        <Stat value={item?.members ?? people.filter((user) => user.role === "member").length} label="участников" />
        <Stat value={item ? `${item.active14}` : "—"} label="активны за 14 дней" />
        <Stat value={item?.submissions7 ?? "—"} label="работ за неделю" />
        <Stat value={item ? `+${item.newMembers30}` : "—"} label="новых за месяц" />
        <Stat value={formatHours(item?.avgReviewHours ?? null)} label="в среднем ждёт проверка" />
        <Stat value={item?.pending ?? "—"} label="сейчас на проверке" />
      </div>
      <section>
        <h3 className={styles.sectionTitle}>Наставники</h3>
        {mentors.length ? <ul className={styles.people}>{mentors.map((mentor) => <li key={mentor.id}><Avatar className={styles.avatar} name={mentor.name} src={mentor.avatarUrl} /><span>{mentor.name}</span></li>)}</ul>
          : <p className={styles.warning}>Наставника нет. Назначьте роль «Наставник» кому-то из команды в разделе «Пользователи».</p>}
      </section>
      <section>
        <h3 className={styles.sectionTitle}>Последние задания</h3>
        {item?.recentTasks.length ? <ul className={styles.tasks}>{item.recentTasks.map((task) => <li key={task.id}><span>{task.title}</span><small>{formatDate(task.createdAt)}</small></li>)}</ul>
          : <p className={styles.muted}>Активных заданий пока нет.</p>}
      </section>
    </div>
  </ModalSheet>;
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return <div><strong>{value}</strong><small>{label}</small></div>;
}
