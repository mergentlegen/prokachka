"use client";

import { useMemo, useState } from "react";
import type { NetworkMember } from "@/shared/domain/types";
import { Avatar } from "@/frontend/shared/Avatar";
import { buildNetworkTree, networkDescendantIds } from "@/frontend/shared/lib/network-tree";
import { MAX_LEVEL, levelLabel } from "@/shared/domain/levels";
import styles from "./NetworkMemberSettings.module.css";

export type NetworkUserPatch = { parentUserId?: string | null; canReview?: boolean; canPublishTasks?: boolean; level?: number };
type Permission = "canReview" | "canPublishTasks";
type Pending = { kind: "parent"; parent: NetworkMember | null } | { kind: Permission; value: boolean } | { kind: "level"; level: number };

const PICKER_LIMIT = 8;
const permissions: Record<Permission, { label: string; hint: string; grant: string; revoke: string; grantNote: string }> = {
  canReview: { label: "Проверяет работы", hint: "Проверка работ, отклики и звёзды своей ветки", grant: "Разрешить проверять работы?", revoke: "Забрать право проверять работы?", grantNote: "Участник увидит работы своей ветки и сможет начислять мили и звёзды." },
  canPublishTasks: { label: "Публикует задания", hint: "Задания, программы и объявления", grant: "Разрешить публиковать задания?", revoke: "Забрать право публиковать задания?", grantNote: "Участник сможет создавать задания, программы и объявления." },
};

// Every structural change asks for confirmation: moving one person also moves their entire branch.
export function NetworkMemberSettings({ user, users, busy, onSave }: {
  user: NetworkMember; users: NetworkMember[]; busy: boolean; onSave: (input: NetworkUserPatch) => Promise<boolean>;
}) {
  const entries = useMemo(() => buildNetworkTree(users), [users]);
  const excluded = useMemo(() => networkDescendantIds(entries, user.id), [entries, user.id]);
  const branchSize = excluded.size - 1;
  const parent = user.parentUserId ? users.find((candidate) => candidate.id === user.parentUserId) : undefined;
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);

  const search = query.trim().toLocaleLowerCase("ru");
  const matches = users
    .filter((candidate) => !excluded.has(candidate.id) && candidate.id !== user.parentUserId && `${candidate.name} ${candidate.login || ""}`.toLocaleLowerCase("ru").includes(search))
    .sort((a, b) => Number(b.role === "admin") - Number(a.role === "admin") || a.name.localeCompare(b.name, "ru"));

  async function confirm() {
    if (!pending) return;
    const input: NetworkUserPatch = pending.kind === "parent" ? { parentUserId: pending.parent?.id ?? null } : pending.kind === "level" ? { level: pending.level } : { [pending.kind]: pending.value };
    if (await onSave(input)) { setPending(null); setPicking(false); setQuery(""); }
  }

  if (pending) {
    const level = user.level ?? 1;
    const question = pending.kind === "level"
      ? pending.level > level ? `Перевести на уровень ${pending.level}?` : `Вернуть на уровень ${pending.level}?`
      : pending.kind === "parent"
        ? pending.parent ? `Перенести в ветку «${pending.parent.name}»?` : "Убрать руководителя?"
        : pending.value ? permissions[pending.kind].grant : permissions[pending.kind].revoke;
    const note = pending.kind === "level"
      ? pending.level > level ? "Участник увидит поздравление, задания и рейтинг нового уровня. Прошлые задания останутся в архиве." : "Участник снова увидит задания и рейтинг этого уровня. Сам по себе он больше не перейдёт — только вашей кнопкой."
      : pending.kind === "parent"
      ? pending.parent ? branchSize ? `Вместе с участником переедет вся его сеть: ${branchSize} чел.` : "Участник переедет один, своей сети у него пока нет." : "Участник окажется в списке «Без закрепления» вместе со своей сетью."
      : pending.value ? permissions[pending.kind].grantNote : "Доступ к этим разделам закроется сразу.";
    return <div className={styles.confirm} role="group" aria-label="Подтверждение изменения">
      <p className={styles.who}>{user.name}</p>
      <p className={styles.question}>{question}</p>
      <p className={styles.note}>{note}</p>
      <div className={styles.actions}>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void confirm()}>{busy ? "Сохраняем..." : "Да, сохранить"}</button>
        <button type="button" className="button" disabled={busy} onClick={() => setPending(null)}>Отмена</button>
      </div>
    </div>;
  }

  return <div className={styles.settings}>
    <div className={styles.field}>
      <span className={styles.label}>Руководитель</span>
      <div className={styles.current}>
        <span>{parent ? parent.name : "Без руководителя"}</span>
        <button type="button" className="button button-edit" disabled={busy} onClick={() => { setPicking((value) => !value); setQuery(""); }}>{picking ? "Отмена" : "Изменить"}</button>
      </div>
      {picking && <div className={styles.picker}>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти по имени или логину" aria-label="Поиск нового руководителя" />
        <ul>
          {user.parentUserId && !search && <li><button type="button" onClick={() => setPending({ kind: "parent", parent: null })}><span className={styles.noLeader} aria-hidden="true">—</span><span>Без руководителя</span></button></li>}
          {matches.slice(0, PICKER_LIMIT).map((candidate) => <li key={candidate.id}><button type="button" onClick={() => setPending({ kind: "parent", parent: candidate })}>
            <Avatar name={candidate.name} src={candidate.avatarUrl} />
            <span>{candidate.name}{candidate.login && <small>@{candidate.login}</small>}</span>
          </button></li>)}
        </ul>
        {matches.length > PICKER_LIMIT && <small className={styles.hint}>Показаны первые {PICKER_LIMIT} из {matches.length}. Уточните поиск.</small>}
        {matches.length === 0 && <small className={styles.hint}>Никого не нашли. Участников из сети этого человека выбрать нельзя.</small>}
      </div>}
    </div>
    <div className={styles.field}>
      <span className={styles.label}>Уровень</span>
      <div className={styles.current}>
        <span>{levelLabel(user.level ?? 1)}</span>
        <span className={styles.levelButtons}>
          {(user.level ?? 1) > 1 && <button type="button" className="button button-edit" disabled={busy} onClick={() => setPending({ kind: "level", level: (user.level ?? 1) - 1 })}>Вернуть на {(user.level ?? 1) - 1}</button>}
          {(user.level ?? 1) < MAX_LEVEL && <button type="button" className="button button-edit" disabled={busy} onClick={() => setPending({ kind: "level", level: (user.level ?? 1) + 1 })}>Перевести на {(user.level ?? 1) + 1}</button>}
        </span>
      </div>
      <small className={styles.hint}>Сам переход происходит при 300 на Звёздном курсе. Кнопки — для особых случаев.</small>
    </div>
    <div className={styles.switches}>
      {(Object.keys(permissions) as Permission[]).map((key) => <label className={styles.switch} key={key}>
        <span><strong>{permissions[key].label}</strong><small>{permissions[key].hint}</small></span>
        <input type="checkbox" role="switch" checked={Boolean(user[key])} disabled={busy} onChange={(event) => setPending({ kind: key, value: event.target.checked })} />
      </label>)}
    </div>
  </div>;
}
