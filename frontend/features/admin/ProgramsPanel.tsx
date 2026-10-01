"use client";

import { useState } from "react";
import { deleteAdminProgram, updateAdminProgram } from "@/frontend/shared/api/admin-client";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import { actionIcons } from "./AdminIcons";
import { PinBadge, PinButton } from "@/frontend/shared/PublicationPin";
import { comparePublications } from "@/shared/domain/publication-order";
import { formatDate, formatMiles } from "@/frontend/shared/lib/format";
import type { Task, TaskProgram } from "@/shared/domain/types";
import type { ProgramHistory } from "@/shared/domain/history";
import { plural } from "@/frontend/shared/lib/plural";
import { TaskRows } from "./AdminViews";
import styles from "./ProgramsPanel.module.css";

type Props = {
  programs: TaskProgram[]; tasks: Task[]; actorId: string; canManageAll: boolean; history?: ProgramHistory[];
  taskBusyId?: string;
  onChange: (programs: TaskProgram[], tasks: Task[]) => void; onError: (message: string) => void;
  onEditTask: (task: Task) => void; onToggleTask: (id: string) => void; onRemoveTask: (task: Task) => void;
};

export function ProgramsPanel({ programs, tasks, actorId, canManageAll, history = [], taskBusyId, onChange, onError, onEditTask, onToggleTask, onRemoveTask }: Props) {
  const customPrograms = programs.filter((program) => !program.templateKey).sort(comparePublications);
  const [busyId, setBusyId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskProgram | null>(null);

  async function update(program: TaskProgram, patch: { isActive?: boolean; isPinned?: boolean }) {
    if (busyId) return;
    setBusyId(program.id);
    try {
      const updated = await updateAdminProgram(program.id, patch);
      onChange(programs.map((item) => item.id === updated.id ? updated : item), tasks);
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось изменить программу."); }
    finally { setBusyId(""); }
  }

  async function remove() {
    if (!deleteTarget || busyId) return;
    const program = deleteTarget;
    setBusyId(program.id);
    try {
      const cleanupWarning = await deleteAdminProgram(program.id);
      onChange(programs.filter((item) => item.id !== program.id), tasks.filter((task) => task.programId !== program.id));
      onError(cleanupWarning ? "Программа и шаги удалены, но часть PDF не удалось очистить из хранилища." : "Программа и её шаги удалены.");
      setDeleteTarget(null);
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось удалить программу."); }
    finally { setBusyId(""); }
  }

  return <>
    <p className="admin-muted">Участники проходят шаги последовательно. Откройте программу, чтобы посмотреть или изменить её задания.</p>
    <div className="admin-panel table-panel">
      {customPrograms.length === 0 ? <div className="empty-admin"><p>Программ пока нет. Создайте первую программу.</p></div> : customPrograms.map((program) => {
        const canManage = canManageAll || program.publisherId === actorId;
        const steps = tasks.filter((task) => task.programId === program.id).sort((a, b) => (a.position || 0) - (b.position || 0) || a.id.localeCompare(b.id));
        const isExpanded = expanded === program.id;
        return <section key={program.id} className={styles.program}>
          <div className="task-admin-row">
            <div className="task-admin-main">
              <span className={"status-dot " + (program.isActive ? "active-dot" : "")} />
              <div>{program.isPinned && <PinBadge />}
                <button type="button" className={styles.programTitle} aria-expanded={isExpanded} aria-controls={"program-steps-" + program.id} onClick={() => setExpanded(isExpanded ? null : program.id)}>{program.title}<span aria-hidden="true">{isExpanded ? "⌃" : "⌄"}</span></button>
                <span>{formatDate(program.createdAt)} · {steps.length} шагов · {program.deadlineHours} ч на шаг</span>
              </div>
            </div>
            <span className={"admin-status " + (program.isActive ? "active" : "inactive")}>{program.isActive ? "Активна" : "Скрыта"}</span>
            <span className="task-max">до {formatMiles(steps.reduce((total, task) => total + task.maxPoints, 0))}</span>
            {canManage && <div className="row-actions">
              <PinButton pinned={program.isPinned} title={program.title} disabled={Boolean(busyId)} onClick={() => void update(program, { isPinned: !program.isPinned })} />
              <button type="button" className={"button " + (program.isActive ? "button-warning" : "button-success")} disabled={Boolean(busyId)} onClick={() => void update(program, { isActive: !program.isActive })}>{program.isActive ? <>{actionIcons.hide}Скрыть</> : <>{actionIcons.show}Показать</>}</button>
              <button type="button" className="button button-danger" disabled={Boolean(busyId)} onClick={() => setDeleteTarget(program)}>{actionIcons.remove}Удалить</button>
            </div>}
          </div>
          {isExpanded && <div id={"program-steps-" + program.id} className={styles.steps}>
            <ProgramFunnel progress={history.find((item) => item.id === program.id)} steps={steps} />
            <div className={styles.stepsHeading}>Задания программы <span>По порядку прохождения</span></div>
            <TaskRows tasks={steps} actorId={actorId} canManageAll={canManageAll} busyId={taskBusyId} onEdit={onEditTask} onToggle={onToggleTask} onRemove={onRemoveTask} />
          </div>}
        </section>;
      })}
    </div>
    {deleteTarget && <ConfirmModal title="Удалить программу?" description={<>«{deleteTarget.title}», все её шаги и отправленные работы будут удалены без возможности восстановления.</>} confirmLabel="Удалить программу" busy={Boolean(busyId)} onClose={() => { if (!busyId) setDeleteTarget(null); }} onConfirm={() => void remove()} />}
  </>;
}

// Where participants are right now: one bar per step, plus everyone who finished.
export function programFunnel(progress: ProgramHistory | undefined, steps: Task[]) {
  const atStep = new Map<number, number>();
  let completed = 0;
  for (const member of progress?.members || []) {
    if (member.status === "completed") completed++;
    else if (member.currentStep) atStep.set(member.currentStep, (atStep.get(member.currentStep) || 0) + 1);
  }
  return { total: progress?.members.length || 0, completed, rows: steps.map((step, index) => ({ id: step.id, title: step.title, position: step.position || index + 1, count: atStep.get(step.position || index + 1) || 0 })) };
}

function ProgramFunnel({ progress, steps }: { progress?: ProgramHistory; steps: Task[] }) {
  const funnel = programFunnel(progress, steps);
  if (!progress || funnel.total === 0) return <p className={styles.funnelEmpty}>{progress ? "Программу пока никто не начал." : "Загружаем, кто на каком шаге…"}</p>;
  const max = Math.max(1, funnel.completed, ...funnel.rows.map((row) => row.count));
  return <section className={styles.funnel} aria-label="Кто на каком шаге">
    <div className={styles.funnelHead}><strong>Кто на каком шаге</strong><span>{funnel.total} {plural(funnel.total, "участник", "участника", "участников")} в программе</span></div>
    {funnel.rows.map((row) => <div className={styles.funnelRow} key={row.id}>
      <span className={styles.funnelLabel}><b>{row.position}</b>{row.title}</span>
      <span className={styles.funnelBar}><i style={{ width: `${(row.count / max) * 100}%` }} /></span>
      <strong>{row.count}</strong>
    </div>)}
    <div className={`${styles.funnelRow} ${styles.funnelDone}`}>
      <span className={styles.funnelLabel}><b>✓</b>Завершили программу</span>
      <span className={styles.funnelBar}><i style={{ width: `${(funnel.completed / max) * 100}%` }} /></span>
      <strong>{funnel.completed}</strong>
    </div>
  </section>;
}
