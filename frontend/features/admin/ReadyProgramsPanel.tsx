"use client";

import { useEffect, useState } from "react";
import { loadReadyPrograms, publishReadyProgram, updateAdminProgram, type ReadyProgramStatus } from "@/frontend/shared/api/admin-client";
import { formatMiles } from "@/frontend/shared/lib/format";
import { READY_PROGRAMS } from "@/shared/domain/ready-programs";
import type { Task, TaskProgram } from "@/shared/domain/types";
import styles from "./ReadyProgramsPanel.module.css";

type Props = {
  programs: TaskProgram[];
  tasks: Task[];
  actorId: string;
  canManageAll: boolean;
  onChange: (programs: TaskProgram[], tasks: Task[]) => void;
  onError: (message: string) => void;
};

type CatalogFilter = "all" | "published" | "available";
const rewards = new Map(READY_PROGRAMS.map((program) => [program.key, program.tasks.reduce((total, task) => total + task.maxPoints, 0)]));
const filters: { value: CatalogFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "published", label: "Добавленные" },
  { value: "available", label: "Доступные" },
];

export function ReadyProgramsPanel({ programs, tasks, actorId, canManageAll, onChange, onError }: Props) {
  const [readyPrograms, setReadyPrograms] = useState<ReadyProgramStatus[]>(() => READY_PROGRAMS.map(({ tasks: _tasks, ...program }) => ({ ...program, published: false })));
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState<{ key: string; message: string } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [reload, setReload] = useState(0);

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

  const publications = new Map(programs.filter((program) => program.templateKey).map((program) => [program.templateKey, program]));
  const catalog = readyPrograms.map((item) => {
    const program = publications.get(item.key);
    return program ? {
      ...item, published: true, publishedProgramId: program.id, publishedActive: program.isActive,
      canManage: canManageAll || program.publisherId === actorId,
    } : item;
  });
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleItems = catalog.filter((item) =>
    (!normalizedQuery || (item.title + " " + item.description).toLocaleLowerCase("ru").includes(normalizedQuery)) &&
    (filter === "all" || (filter === "published" ? item.publishedActive : !item.publishedActive))
  );

  async function changePublication(item: ReadyProgramStatus) {
    if (busyKey || (item.published && !item.canManage)) return;
    setBusyKey(item.key);
    setActionError(null);
    try {
      let updated: TaskProgram;
      let addedTasks: Task[] = [];
      if (item.publishedProgramId) {
        updated = await updateAdminProgram(item.publishedProgramId, { isActive: !item.publishedActive });
      } else {
        const result = await publishReadyProgram(item.key);
        if (!canManageAll && result.program.publisherId !== actorId) throw new Error("Публикацией этого задания управляет другой наставник.");
        updated = result.program.isActive ? result.program : await updateAdminProgram(result.program.id, { isActive: true });
        addedTasks = result.tasks;
      }
      const taskIds = new Set(addedTasks.map((task) => task.id));
      onChange([updated, ...programs.filter((program) => program.id !== updated.id)], [...addedTasks, ...tasks.filter((task) => !taskIds.has(task.id))]);
      setReadyPrograms((current) => current.map((entry) => entry.key === item.key ? {
        ...entry, published: true, publishedActive: updated.isActive, publishedProgramId: updated.id, canManage: true,
      } : entry));
      onError(updated.isActive ? "«" + item.title + "» добавлено в задания участников." : "«" + item.title + "» убрано из заданий. Результаты и мили сохранены.");
    } catch (error) {
      setActionError({ key: item.key, message: error instanceof Error ? error.message : "Не удалось изменить публикацию. Попробуйте ещё раз." });
    } finally { setBusyKey(""); }
  }

  return <section className={styles.panel} aria-labelledby="ready-programs-title">
    <div className={styles.header}>
      <span className={styles.spark} aria-hidden="true">✦</span>
      <div className={styles.heading}>
        <p className="eyebrow">Быстрый старт</p>
        <h2 id="ready-programs-title">Готовые задания</h2>
        <p className={styles.intro}>Тесты и игры с автоматическим начислением миль. Добавьте их участникам одним нажатием — без настройки шагов и дедлайнов.</p>
      </div>
      <span className={styles.summary}>Добавлено {catalog.filter((item) => item.publishedActive).length} из {catalog.length}</span>
    </div>
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
          <div className={styles.meta}><span>{item.badge}</span><span className={styles.reward}>+{formatMiles(rewards.get(item.key) ?? 0)}</span></div>
          <div className={styles.actions}>
            {managedByAnother ? <p className={styles.ownerNote}>Публикацией управляет другой наставник.</p> :
              <button type="button" className={active ? styles.removeButton : "button button-primary"}
                aria-label={(active ? "Убрать из заданий: " : "Добавить в задания: ") + item.title}
                disabled={Boolean(busyKey) || statusPending || Boolean(loadError && !publications.has(item.key))}
                onClick={() => void changePublication(item)}>
                {busy ? active ? "Убираем…" : "Добавляем…" : statusPending ? "Проверяем статус…" : active ? "Убрать из заданий" : "Добавить в задания"}
              </button>}
            {actionError?.key === item.key && <p className={styles.error} role="alert">{actionError.message}</p>}
          </div>
        </article>;
      })}
    </div>
    {!visibleItems.length && <p className={styles.empty}>Ничего не найдено. Измените поиск или фильтр.</p>}
  </section>;
}
