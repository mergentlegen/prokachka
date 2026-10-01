"use client";

import { useState } from "react";
import type { NetworkMember } from "@/shared/domain/types";
import { NetworkTree } from "@/frontend/shared/NetworkTree";
import { isNewMember, type NetworkSort } from "@/frontend/shared/lib/network-tree";
import styles from "./MemberNetwork.module.css";

export function MemberNetwork({ users, currentUserId, canInvite, inviteUrl, inviteBusy, onCreateInvite, onCopyInvite }: {
  users: NetworkMember[]; currentUserId: string; canInvite: boolean; inviteUrl: string; inviteBusy: boolean;
  onCreateInvite: () => void; onCopyInvite: (url: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<NetworkSort>("name");
  const others = users.filter((user) => user.id !== currentUserId);
  const firstLine = others.filter((user) => user.parentUserId === currentUserId).length;
  const hasMiles = users.some((user) => user.points !== undefined);
  return <section className={styles.card}>
    <div className={styles.heading}><p className="eyebrow">Твоя команда</p><h2>Моя структура</h2></div>

    <div className={styles.stats}>
      <div><strong>{firstLine}</strong><small>в 1-й линии</small></div>
      <div><strong>{others.length}</strong><small>всего в сети</small></div>
      <div><strong>{others.filter((user) => isNewMember(user)).length}</strong><small>новых за неделю</small></div>
    </div>

    {canInvite && <div className={styles.invite}>
      <div><strong>Пригласить в команду</strong><small>{others.length ? "Бессрочная ссылка. Вступление подтверждает наставник." : "В твоей сети пока никого нет. Поделись ссылкой: после подтверждения наставником человек появится здесь."}</small></div>
      {inviteUrl
        ? <div className={styles.inviteLink}><input aria-label="Твоя ссылка приглашения" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="button button-primary" onClick={() => onCopyInvite(inviteUrl)}>Копировать</button></div>
        : <button type="button" className="button button-primary" disabled={inviteBusy} onClick={onCreateInvite}>{inviteBusy ? "Создаём..." : "Получить ссылку"}</button>}
    </div>}

    {others.length > 0 && <div className={styles.controls}>
      <label className={styles.search}><span>Поиск в своей сети</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или логин" /></label>
      {hasMiles && <label className={styles.sort}><span>Порядок</span><select value={sort} onChange={(event) => setSort(event.target.value as NetworkSort)}>
        <option value="name">По имени</option><option value="miles">Больше миль выше</option>
      </select></label>}
    </div>}

    <div className={styles.tree}><NetworkTree users={users} currentUserId={currentUserId} query={query} sort={sort} onClearSearch={() => setQuery("")} /></div>
  </section>;
}
