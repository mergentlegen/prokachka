"use client";

import { useState, type ReactNode } from "react";
import type { Team } from "@/shared/domain/types";
import type { CeoJournalEntry } from "@/frontend/shared/api/ceo-client";
import { ceoIcons } from "./CeoIcons";
import { describeJournalEntry, filterJournal, groupJournalByDay, journalCategory, journalMoment, roleName, type JournalFilter } from "./journal-format";
import styles from "./CeoJournal.module.css";

const svg = (children: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const categoryIcons: Record<Exclude<JournalFilter, "all">, ReactNode> = {
  people: ceoIcons.users, teams: ceoIcons.teams, content: ceoIcons.works,
  stars: svg(<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />),
  messages: svg(<><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>),
};
const filters: Array<[JournalFilter, string]> = [["all", "Все"], ["people", "Люди"], ["teams", "Команды"], ["content", "Задания и объявления"], ["stars", "Звёзды"], ["messages", "Рассылки"]];

function JournalRow({ entry, compact }: { entry: CeoJournalEntry; compact?: boolean }) {
  const item = describeJournalEntry(entry);
  return <li className={styles.row}>
    <span className={`${styles.badge} ${styles[item.tone]}`}>{categoryIcons[item.category]}</span>
    <div className={styles.body}>
      <p className={styles.head}><strong>{item.title}</strong>{item.target && <span> «{item.target}»</span>}</p>
      {!compact && item.lines.length > 0 && <ul className={styles.lines}>{item.lines.map((line) => <li key={line}>{line}</li>)}</ul>}
      <small className={styles.meta}>{entry.actorName}{entry.actorRole !== "ceo" && ` · ${roleName(entry.actorRole).toLocaleLowerCase("ru")}`}{entry.teamLabel && ` · ${entry.teamLabel}`}</small>
    </div>
    <time className={styles.time} dateTime={entry.createdAt}>{journalMoment(entry.createdAt, Boolean(compact))}</time>
  </li>;
}

export function CeoJournalView({ teams, entries, hasMore, loading, failed, onMore, onRetry }: {
  teams: Team[]; entries: CeoJournalEntry[]; hasMore: boolean; loading: boolean; failed: boolean; onMore: () => void; onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<JournalFilter>("all");
  const [teamId, setTeamId] = useState("");
  const shown = filterJournal(entries, { query, filter, teamId });
  const groups = groupJournalByDay(shown);
  const count = (value: JournalFilter) => value === "all" ? entries.length : entries.filter((entry) => journalCategory(entry) === value).length;

  return <div className={styles.panel}>
    <p className={styles.intro}>Кто и что менял на платформе: доступы, команды, публикации, звёзды и рассылки. Записи нельзя изменить или удалить.</p>
    <div className={styles.tools}>
      <label className={styles.search}><span>Поиск в журнале</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, задание или команда" /></label>
      <label className={styles.team}><span>Команда</span><select value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="">Все команды</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
    </div>
    <div className={styles.chips} role="group" aria-label="Показать">{filters.filter(([id]) => id === "all" || count(id) > 0 || filter === id).map(([id, label]) => <button type="button" key={id} className={filter === id ? styles.active : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<b>{count(id)}</b></button>)}</div>
    {failed && entries.length === 0 ? <div className={styles.empty}><strong>Не удалось загрузить журнал</strong><p>Проверьте соединение и попробуйте ещё раз.</p><button type="button" className="button button-primary" onClick={onRetry}>Повторить</button></div>
      : loading && entries.length === 0 ? <div className={styles.empty}><p>Загружаем журнал…</p></div>
      : entries.length === 0 ? <div className={styles.empty}><span aria-hidden="true">{ceoIcons.journal}</span><strong>Журнал пока пуст</strong><p>Записи появятся, как только CEO или наставники изменят доступы, команды, задания, объявления или звёзды.</p></div>
      : shown.length === 0 ? <div className={styles.empty}><p>Ничего не нашли. Измените поиск или фильтр.</p></div>
      : groups.map((group) => <section key={group.key} className={styles.day} aria-label={group.label}>
        <h3>{group.label}</h3>
        <ul className={styles.list}>{group.entries.map((entry) => <JournalRow key={entry.id} entry={entry} />)}</ul>
      </section>)}
    {hasMore && entries.length > 0 && <button type="button" className={styles.more} disabled={loading} onClick={onMore}>{loading ? "Загружаем…" : "Показать более ранние"}</button>}
  </div>;
}

// The last few entries on the overview, with a way into the full journal.
export function CeoRecentActions({ entries, onOpen }: { entries: CeoJournalEntry[]; onOpen: () => void }) {
  if (entries.length === 0) return null;
  return <section className={styles.recent} aria-labelledby="ceo-recent-actions">
    <div className={styles.recentHead}><h2 id="ceo-recent-actions">Последние действия</h2><button type="button" onClick={onOpen}>Весь журнал <span aria-hidden="true">→</span></button></div>
    <ul className={styles.list}>{entries.slice(0, 5).map((entry) => <JournalRow key={entry.id} entry={entry} compact />)}</ul>
  </section>;
}
