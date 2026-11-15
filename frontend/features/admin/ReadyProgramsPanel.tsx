"use client";

import { useEffect, useState } from "react";
import { loadReadyPrograms, publishReadyProgram, updateAdminProgram, type ReadyProgramStatus } from "@/frontend/shared/api/admin-client";
import { PinBadge, PinButton } from "@/frontend/shared/PublicationPin";
import { comparePublications } from "@/shared/domain/publication-order";
import { formatMiles } from "@/frontend/shared/lib/format";
import { READY_PROGRAMS } from "@/shared/domain/ready-programs";
import { LEVELS } from "@/shared/domain/levels";
import type { Task, TaskProgram } from "@/shared/domain/types";
import styles from "./ReadyProgramsPanel.module.css";

type Props = {
  programs: TaskProgram[];
  tasks: Task[];
  actorId: string;
  canManageAll: boolean;
  onChange: (programs: TaskProgram[], tasks: Task[]) => void;
  onError: (message: string) => void;
  /** Inside the catalog window: the window carries the title, so the panel drops its own header. */
  embedded?: boolean;
};

/** Ready games this mentor manages: the whole team's for the team leader, their own branch for others. */
export function readyPublications(programs: TaskProgram[], actorId: string, canManageAll: boolean) {
  return programs.filter((program) => program.templateKey && (canManageAll ? !program.audienceRootId : program.publisherId === actorId && (!program.audienceRootId || program.audienceRootId === actorId)));
}

type CatalogFilter = "all" | "published" | "available";
const rewards = new Map(READY_PROGRAMS.map((program) => [program.key, program.tasks.reduce((total, task) => total + task.maxPoints, 0)]));
const filters: { value: CatalogFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "published", label: "Добавленные" },
  { value: "available", label: "Доступные" },
];

export function ReadyProgramsPanel({ programs, tasks, actorId, canManageAll, onChange, onError, embedded = false }: Props) {
  const [readyPrograms, setReadyPrograms] = useState<ReadyProgramStatus[]>(() => READY_PROGRAMS.map(({ tasks: _tasks, ...program }) => ({ ...program, published: false })));
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [pinning, setPinning] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState<{ key: string; message: string } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [reload, setReload] = useState(0);
  // The level chosen on a card before «Добавить в задания».
  const [chosenLevels, setChosenLevels] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void loadReadyPrograms().then((items) => {
      if (!cancelled) { setReadyPrograms(items); setLoadError(""); }
    }).catch((error) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : "Не удалось проверить статус готовых заданий.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [programs, reload]);

  const publications = new Map(readyPublications(programs, actorId, canManageAll).map((program) => [program.templateKey, program]));
  const catalog = readyPrograms.map((item) => {
    const program = publications.get(item.key);
    return program ? {
      ...item, published: true, publishedProgramId: program.id, publishedActive: program.isActive, publishedPinned: program.isPinned, publishedPinnedAt: program.pinnedAt, publishedCreatedAt: program.createdAt, publishedLevel: program.level ?? 1,
      canManage: canManageAll || program.publisherId === actorId,
    } : item;
  }).sort((a, b) => comparePublications(
    { id: a.key, createdAt: a.publishedCreatedAt || "9999", isPinned: a.publishedActive && a.publishedPinned, pinnedAt: a.publishedPinnedAt },
    { id: b.key, createdAt: b.publishedCreatedAt || "9999", isPinned: b.publishedActive && b.publishedPinned, pinnedAt: b.publishedPinnedAt },
  ));
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleItems = catalog.filter((item) =>
    (!normalizedQuery || (item.title + " " + item.description).toLocaleLowerCase("ru").includes(normalizedQuery)) &&
    (filter === "all" || (filter === "published" ? item.publishedActive : !item.publishedActive))
  );

  const levelOf = (item: ReadyProgramStatus) => item.publishedActive ? item.publishedLevel ?? 1 : chosenLevels[item.key] ?? item.publishedLevel ?? 1;

  async function changePublication(item: ReadyProgramStatus) {
    if (busyKey || (item.published && !item.canManage)) return;
    setBusyKey(item.key);
    setActionError(null);
    const level = levelOf(item);
    try {
      let updated: TaskProgram;
      let addedTasks: Task[] = [];
      if (item.publishedProgramId) {
        updated = await updateAdminProgram(item.publishedProgramId, item.publishedActive ? { isActive: false } : { isActive: true, level });
      } else {
        const result = await publishReadyProgram(item.key, level);
        if (!canManageAll && result.program.publisherId !== actorId) throw new Error("Публикацией этого задания управляет другой наставник.");
        updated = result.program.isActive ? result.program : await updateAdminProgram(result.program.id, { isActive: true });
        addedTasks = result.tasks;
      }
      const taskIds = new Set(addedTasks.map((task) => task.id));
      onChange([updated, ...programs.filter((program) => program.id !== updated.id)], [...addedTasks, ...tasks.filter((task) => !taskIds.has(task.id))]);
      setReadyPrograms((current) => current.map((entry) => entry.key === item.key ? {
        ...entry, published: true, publishedActive: updated.isActive, publishedProgramId: updated.id, publishedLevel: updated.level ?? 1, publishedPinned: updated.isPinned, publishedPinnedAt: updated.pinnedAt, publishedCreatedAt: updated.createdAt, canManage: true,
      } : entry));
      onError(updated.isActive ? `«${item.title}» добавлено в задания участников${(updated.level ?? 1) > 1 ? ` уровня ${updated.level}` : ""}.` : "«" + item.title + "» убрано из заданий. Результаты и мили сохранены.");
    } catch (error) {
      setActionError({ key: item.key, message: error instanceof Error ? error.message : "Не удалось изменить публикацию. Попробуйте ещё раз." });
    } finally { setBusyKey(""); }
  }

  // A game already in the tasks moves to another level at once; miles for passing it count on that level.
  async function moveLevel(item: ReadyProgramStatus, level: number) {
    if (!item.publishedActive) { setChosenLevels((current) => ({ ...current, [item.key]: level })); return; }
    if (busyKey || !item.publishedProgramId || !item.canManage || level === (item.publishedLevel ?? 1)) return;
    setBusyKey(item.key); setActionError(null);
    try {
      const updated = await updateAdminProgram(item.publishedProgramId, { level });
      onChange([...programs.filter((program) => program.id !== updated.id), updated], tasks.map((task) => task.programId === updated.id ? { ...task, level: level > 1 ? level : undefined } : task));
      setReadyPrograms((current) => current.map((entry) => entry.key === item.key ? { ...entry, publishedLevel: updated.level ?? 1 } : entry));
      onError(`«${item.title}» теперь для уровня ${level}. Мили тех, кто уже прошёл игру, считаются в рейтинге этого уровня.`);
    } catch (error) {
      setActionError({ key: item.key, message: error instanceof Error ? error.message : "Не удалось перенести игру на другой уровень." });
    } finally { setBusyKey(""); }
  }

  async function pin(item: ReadyProgramStatus) {
    if (busyKey || !item.publishedProgramId || !item.canManage) return;
    setBusyKey(item.key); setPinning(true); setActionError(null);
    try {
      const updated = await updateAdminProgram(item.publishedProgramId, { isPinned: !item.publishedPinned });
      onChange([...programs.filter((program) => program.id !== updated.id), updated], tasks);
      setReadyPrograms((current) => current.map((entry) => entry.key === item.key ? { ...entry, publishedPinned: updated.isPinned, publishedPinnedAt: updated.pinnedAt } : entry));
    } catch (error) {
      setActionError({ key: item.key, message: error instanceof Error ? error.message : "Не удалось изменить закрепление." });
    } finally { setBusyKey(""); setPinning(false); }
  }

  return <section className={`${styles.panel} ${embedded ? styles.embedded : ""}`} aria-labelledby={embedded ? undefined : "ready-programs-title"} aria-label={embedded ? "Каталог готовых заданий" : undefined}>
    {!embedded && <div className={styles.header}>
      <span className={styles.spark} aria-hidden="true">✦</span>
      <div className={styles.heading}>
        <p className="eyebrow">Быстрый старт</p>
        <h2 id="ready-programs-title">Готовые задания</h2>
        <p className={styles.intro}>Тесты и игры с автоматическим начислением миль. {canManageAll ? "Публикации здесь доступны всей команде." : "Публикации здесь доступны вам и участникам ниже по вашей ветке."} Без настройки шагов и дедлайнов.</p>
      </div>
      <span className={styles.summary}>Добавлено {catalog.filter((item) => item.publishedActive).length} из {catalog.length}</span>
    </div>}
    {embedded && <p className={styles.embeddedIntro}>Тесты и игры с автоматическим начислением миль. Добавленные появляются у участников в «Заданиях». Добавлено {catalog.filter((item) => item.publishedActive).length} из {catalog.length}.</p>}
    {loadError && <div className={styles.warning} role="status">
      <span>Не удалось проверить статус каталога. Попробуйте загрузить его ещё раз.</span>
      <button type="button" disabled={loading} onClick={() => { setLoading(true); setReload((value) => value + 1); }}>Повторить</button>
    </div>}
    {catalog.length > 1 && <div className={styles.controls}>
      <input type="search" aria-label="Поиск готовых заданий" placeholder="Найти тест или игру" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className={styles.filters} role="group" aria-label="Статус готовых заданий">
        {filters.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
      </div>
    </div>}
    <div className={styles.grid}>
      {visibleItems.map((item) => {
        const active = Boolean(item.publishedActive);
        const busy = busyKey === item.key;
        const managedByAnother = item.published && !item.canManage;
        const statusPending = loading && !publications.has(item.key);
        return <article className={styles.card} key={item.key} aria-busy={busy}>
          <div className={styles.cardTop}>
            <span className={styles.icon} aria-hidden="true">✦</span>
            <span className={active ? styles.published : styles.available}>{active ? "В заданиях" : "Не добавлено"}</span>
          </div>
          <p className={styles.eyebrow}>{item.eyebrow}</p>
          <h3>{item.title}</h3>
          <p className={styles.description}>{item.description}</p>
          <div className={styles.meta}>{active && item.publishedPinned && <PinBadge />}<span>{item.badge}</span><span className={styles.reward}>+{formatMiles(rewards.get(item.key) ?? 0)}</span></div>
          {!managedByAnother && <label className={styles.level}>Для кого
            <select value={levelOf(item)} disabled={Boolean(busyKey) || statusPending} onChange={(event) => void moveLevel(item, Number(event.target.value))}>
              {LEVELS.map((level) => <option key={level} value={level}>Уровень {level}</option>)}
            </select>
          </label>}
          <div className={styles.actions}>
            {managedByAnother ? <p className={styles.ownerNote}>Публикацией управляет другой наставник.</p> :
              <button type="button" className={active ? styles.removeButton : "button button-primary"}
                aria-label={(active ? "Убрать из заданий: " : "Добавить в задания: ") + item.title}
                disabled={Boolean(busyKey) || statusPending || Boolean(loadError && !publications.has(item.key))}
                onClick={() => void changePublication(item)}>
                {busy && !pinning ? active ? "Убираем…" : "Добавляем…" : statusPending ? "Проверяем статус…" : active ? "Убрать из заданий" : "Добавить в задания"}
              </button>}
            {active && !managedByAnother && <div className={styles.pinAction}><PinButton pinned={item.publishedPinned} title={item.title} disabled={Boolean(busyKey)} onClick={() => void pin(item)} /></div>}
            {actionError?.key === item.key && <p className={styles.error} role="alert">{actionError.message}</p>}
          </div>
        </article>;
      })}
    </div>
    {!visibleItems.length && <p className={styles.empty}>{catalog.length === 0 ? "Готовых заданий пока нет." : normalizedQuery || filter !== "all" ? "Ничего не найдено. Измените поиск или фильтр." : "Готовых заданий пока нет."}</p>}
  </section>;
}
