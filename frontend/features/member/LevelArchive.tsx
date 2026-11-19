"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ProgramModule, Submission, Task } from "@/shared/domain/types";
import { loadMemberLevelArchive } from "@/frontend/shared/api/client";
import { levelHasOnlyPrograms, levelTitle } from "@/shared/domain/levels";
import { compareTaskFeed } from "@/shared/domain/task-feed-order";
import { plural } from "@/frontend/shared/lib/plural";
import { ProgramModules } from "./ProgramModules";
import { TaskCard } from "./TaskCard";
import styles from "./LevelArchive.module.css";

/** «Уровень 2 · Капитан» and the earlier levels, which open as an archive. */
export function LevelSwitch({ level, viewing, onChange }: { level: number; viewing: number; onChange: (level: number) => void }) {
  const levels = Array.from({ length: level }, (_, index) => level - index);
  return <div className={styles.switch} role="tablist" aria-label="Уровень">
    {levels.map((item) => <button type="button" role="tab" key={item} aria-selected={viewing === item} className={viewing === item ? styles.on : ""} onClick={() => onChange(item)}>
      <b>Уровень {item}</b><small>{item === level ? levelTitle(item) : "архив"}</small>
    </button>)}
  </div>;
}

type Archive = { tasks: Task[]; programModules: ProgramModule[]; passedTasks: Task[] };

/**
 * An earlier level, to read again: its tasks, programs, games, materials, questions and answers.
 * Nothing new can be sent from here; only a work a mentor returned for changes can be sent again.
 */
export function LevelArchive({ level, latest, onFeedback, onSubmit, onProgress }: { level: number; latest: Map<string, Submission>; onFeedback: (taskId: string) => void;
  /** Sends a returned work again (opens Telegram). */ onSubmit: (task: Task) => Promise<void>; /** A returned test was sent again from the site. */ onProgress?: () => void }) {
  const [archive, setArchive] = useState<{ level: number; data: Archive } | null>(null);
  const [error, setError] = useState<{ level: number; message: string } | null>(null);
  const [chosenView, setView] = useState<"regular" | "programs">("regular");
  // Level 2 and higher have programs only.
  const onlyPrograms = levelHasOnlyPrograms(level);
  const view = onlyPrograms ? "programs" : chosenView;
  const [programTab, setProgramTab] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadMemberLevelArchive(level)
      .then((data) => { if (active) setArchive({ level, data }); })
      .catch(() => { if (active) setError({ level, message: "Не удалось открыть архив. Попробуйте ещё раз." }); });
    return () => { active = false; };
  }, [level]);
  const data = archive?.level === level ? archive.data : null;
  // The same order as the mentor set it, like on the current level.
  const regular = data ? data.tasks.filter((task) => task.publicationType !== "sequential").sort(compareTaskFeed) : [];
  const steps = data ? data.tasks.filter((task) => task.publicationType === "sequential") : [];
  const card = (task: Task, inModule = false): ReactNode => <TaskCard key={task.id} task={task} submission={latest.get(task.id)} onSubmit={() => onSubmit(task)} onFeedback={onFeedback} onInteractiveProgress={onProgress} readOnly inModule={inModule} />;
  return <div className={styles.archive}>
    <p className={styles.note}><span aria-hidden="true">📚</span>Архив уровня {level}: {onlyPrograms ? "программы, видео и материалы" : "задания, программы, игры, видео и материалы"} можно пересмотреть. Новые ответы здесь не отправляются — только работы, которые наставник вернул на доработку.</p>
    <div className="section-heading"><div><p className="eyebrow">Уровень {level} · архив</p><h2>{onlyPrograms ? "Прошлые программы" : "Прошлые задания"}</h2></div>
      {!onlyPrograms && <div className="task-switch"><button className={view === "regular" ? "active" : ""} onClick={() => setView("regular")}>Задания</button><button className={view === "programs" ? "active" : ""} onClick={() => setView("programs")}>Программы</button></div>}
      {data && <span className="task-count">{view === "programs" ? `${data.programModules.length} ${plural(data.programModules.length, "программа", "программы", "программ")}` : `${regular.length} ${plural(regular.length, "задание", "задания", "заданий")}`}</span>}
    </div>
    {error?.level === level ? <p className={styles.empty}>{error.message}</p>
      : !data ? <p className={styles.empty}>Открываем архив…</p>
        : view === "programs" ? data.programModules.length === 0 ? <p className={styles.empty}>На этом уровне программ не было.</p>
          : <ProgramModules modules={data.programModules} tasks={steps} passedTasks={data.passedTasks} latest={latest} selectedId={programTab} onSelect={setProgramTab} onFeedback={onFeedback} renderTask={(task) => card(task, true)} readAll />
          : regular.length === 0 ? <p className={styles.empty}>На этом уровне заданий не было.</p> : <div className="task-list">{regular.map((task) => card(task))}</div>}
  </div>;
}
