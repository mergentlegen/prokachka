"use client";

import type { ReactNode } from "react";
import type { NetworkMember } from "@/shared/domain/types";
import { Avatar } from "./Avatar";
import { ModalSheet } from "./ModalSheet";
import { isNewMember, networkActivity, networkAncestors, type NetworkEntry } from "./lib/network-tree";
import { milesUnit } from "./lib/format";
import styles from "./NetworkPersonCard.module.css";

const plural = (value: number, one: string, few: string, many: string) => {
  const lastTwo = value % 100, last = value % 10;
  return lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
};

export function daysAgo(value: string, now = Date.now()) {
  const days = Math.max(0, Math.floor((now - Date.parse(value)) / 86_400_000));
  return days === 0 ? "сегодня" : days === 1 ? "вчера" : `${days} ${plural(days, "день", "дня", "дней")} назад`;
}

const fullDate = (value: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));

export function NetworkPersonCard({ entry, byId, currentUserId, canReveal, onReveal, onClose, controls }: {
  entry: NetworkEntry<NetworkMember>; byId: ReadonlyMap<string, NetworkMember>; currentUserId: string;
  canReveal: boolean; onReveal: () => void; onClose: () => void; controls?: ReactNode;
}) {
  const { user, childCount, descendantCount } = entry;
  const ancestors = networkAncestors(byId, user);
  const leader = ancestors[ancestors.length - 1];
  const activity = networkActivity(user);
  const joined = user.teamJoinedAt || user.createdAt;
  const roles = [user.role === "admin" && "Руководитель", user.canReview && "Проверяет работы", user.canPublishTasks && "Публикует задания"].filter(Boolean) as string[];
  const points = user.points ?? 0;
  return <ModalSheet title={user.id === currentUserId ? "Ваша карточка" : "Участник сети"} onClose={onClose}>
    <div className={styles.card}>
      <div className={styles.header}>
        <Avatar className={styles.avatar} name={user.name} src={user.avatarUrl} eager />
        <div>
          <h3>{user.name}</h3>
          {user.login && <p className={styles.login}>@{user.login}</p>}
          <div className={styles.badges}>
            {user.id === currentUserId && <span className={styles.you}>Вы</span>}
            {isNewMember(user) && <span className={styles.new}>Новый</span>}
            {roles.map((role) => <span key={role}>{role}</span>)}
          </div>
        </div>
      </div>

      <div className={styles.stats}>
        {user.role === "member" && <div><strong>{user.points ?? "—"}</strong><small>{milesUnit(points)}</small></div>}
        {user.role === "member" && <div><strong>{user.stars ?? "—"}</strong><small>звёзд</small></div>}
        <div><strong>{childCount}</strong><small>в 1-й линии</small></div>
        <div><strong>{descendantCount}</strong><small>всего в сети</small></div>
      </div>

      <dl className={styles.facts}>
        {leader && <div><dt>Руководитель</dt><dd>{leader.name}</dd></div>}
        {ancestors.length > 1 && <div><dt>Путь в структуре</dt><dd>{[...ancestors, user].map((person) => person.name).join(" → ")}</dd></div>}
        <div><dt>В команде с</dt><dd>{fullDate(joined)}</dd></div>
        {activity && <div><dt>Активность</dt><dd className={styles[activity]}>
          {user.lastSubmittedAt ? `Последняя работа ${daysAgo(user.lastSubmittedAt)}` : "За 30 дней работ не было"}
          {Boolean(user.recentSubmissions) && <small>Работ за 30 дней: {user.recentSubmissions}</small>}
        </dd></div>}
        {user.hasTelegram !== undefined && user.role === "member" && <div><dt>Telegram</dt><dd className={user.hasTelegram ? styles.active : styles.quiet}>{user.hasTelegram ? "Подключён" : "Не подключён — уведомления не приходят"}</dd></div>}
      </dl>

      {canReveal && <button type="button" className={`button button-edit ${styles.reveal}`} onClick={onReveal}>Показать в дереве</button>}
      {controls && <section className={styles.controls} aria-label="Настройки участника"><h4>Настройки</h4>{controls}</section>}
    </div>
  </ModalSheet>;
}
