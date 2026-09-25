"use client";

import { useEffect, useState } from "react";
import { loadReadyPrograms, publishReadyProgram, updateAdminProgram, type ReadyProgramStatus } from "@/frontend/shared/api/admin-client";
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

export function ReadyProgramsPanel({ programs, tasks, actorId, canManageAll, onChange, onError }: Props) {
  const [readyPrograms, setReadyPrograms] = useState<ReadyProgramStatus[]>(() => READY_PROGRAMS.map(({ tasks: _tasks, ...program }) => ({ ...program, published: false })));
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadReadyPrograms().then((items) => {
      if (!cancelled) { setReadyPrograms(items); setLoadError(""); }
    }).catch((error) => {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : "Не удалось загрузить готовые программы.";
        setLoadError(message);
        onError(message + " Примените миграцию готовых программ в Supabase.");
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [onError]);

  async function publish(key: string) {
    if (busyKey) return;
    setBusyKey(key);
    try {
      const result = await publishReadyProgram(key as ReadyProgramStatus["key"]);
      setReadyPrograms((current) => current.map((item) => item.key === key ? { ...item, published: true, publishedActive: true, publishedProgramId: result.program.id } : item));
      if (!result.alreadyPublished) onChange([result.program, ...programs], [...result.tasks, ...tasks]);
      onError(result.alreadyPublished ? "Эта готовая программа уже опубликована." : "Готовая программа опубликована для участников.");
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось опубликовать готовую программу."); }
    finally { setBusyKey(""); }
  }

  async function activate(item: ReadyProgramStatus) {
    if (!item.publishedProgramId || busyKey) return;
    const program = programs.find((current) => current.id === item.publishedProgramId);
    if (!program || (!canManageAll && program.publisherId !== actorId)) return;
    setBusyKey(item.key);
    try {
      const updated = await updateAdminProgram(program.id, { isActive: true });
      onChange(programs.map((current) => current.id === updated.id ? updated : current), tasks.map((task) => task.programId === updated.id ? { ...task, isActive: true } : task));
      setReadyPrograms((current) => current.map((currentItem) => currentItem.key === item.key ? { ...currentItem, publishedActive: true } : currentItem));
      onError("Готовая программа снова доступна участникам.");
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось активировать программу."); }
    finally { setBusyKey(""); }
  }

  return <section className={styles.panel} aria-labelledby="ready-programs-title">
    <div className={styles.header}>
      <div>
        <p className="eyebrow">Быстрый старт</p>
        <h2 id="ready-programs-title">Готовые программы</h2>
        <p className={styles.intro}>Интерактивные сценарии уже собраны. Опубликуйте нужный вариант одним нажатием - без настройки шагов и дедлайнов.</p>
      </div>
      <span className={styles.spark} aria-hidden="true">✦</span>
    </div>
    {loading ? <div className={styles.loading} aria-live="polite">Загружаем готовые программы...</div> : <>
      {loadError && <div className={styles.warning} role="status">Каталог показан в режиме предпросмотра. Чтобы публиковать программы, примените миграцию базы данных и обновите страницу.</div>}
      <div className={styles.grid}>
      {readyPrograms.map((item) => {
        const canActivate = Boolean(item.publishedProgramId && (!programs.find((program) => program.id === item.publishedProgramId) || canManageAll || programs.find((program) => program.id === item.publishedProgramId)?.publisherId === actorId));
        return <article className={styles.card} key={item.key}>
          <div className={styles.cardTop}><span className={styles.icon} aria-hidden="true">✦</span><span className={item.published ? styles.published : styles.available}>{item.published ? item.publishedActive === false ? "Скрыта" : "Опубликована" : "Готово к запуску"}</span></div>
          <p className={styles.eyebrow}>{item.eyebrow}</p>
          <h3>{item.title}</h3>
          <p className={styles.description}>{item.description}</p>
          <div className={styles.meta}><span>{item.badge}</span><span>{item.taskCount} интерактивный шаг</span></div>
          {item.published ? item.publishedActive === false && canActivate ? <button type="button" className="button button-success" disabled={Boolean(busyKey)} onClick={() => void activate(item)}>{busyKey === item.key ? "Активируем..." : "Активировать"}</button> : <button type="button" className={styles.publishedButton} disabled>✓ Уже опубликована</button> : <button type="button" className="button button-primary" disabled={Boolean(busyKey) || Boolean(loadError)} onClick={() => void publish(item.key)}>{busyKey === item.key ? "Публикуем..." : loadError ? "Нужна миграция БД" : "Опубликовать программу"}</button>}
        </article>;
      })}
      </div>
    </>}
  </section>;
}
