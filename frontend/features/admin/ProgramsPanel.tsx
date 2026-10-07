"use client";

import { useState } from "react";
import { addProgramGame, deleteAdminProgram, reorderProgramSteps, updateAdminProgram } from "@/frontend/shared/api/admin-client";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { FIRST_YEAR_DESCRIPTION, FIRST_YEAR_KIND, FIRST_YEAR_REWARD, FIRST_YEAR_TITLE } from "@/shared/domain/first-year";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import { actionIcons } from "./AdminIcons";
import { comparePublications } from "@/shared/domain/publication-order";
import { formatMiles } from "@/frontend/shared/lib/format";
import type { Task, TaskProgram } from "@/shared/domain/types";
import type { ProgramHistory } from "@/shared/domain/history";
import { plural } from "@/frontend/shared/lib/plural";
import styles from "./ProgramsPanel.module.css";

type Props = {
  programs: TaskProgram[]; tasks: Task[]; actorId: string; canManageAll: boolean; history?: ProgramHistory[];
  taskBusyId?: string;
  onChange: (programs: TaskProgram[], tasks: Task[]) => void; onError: (message: string) => void;
  onEditTask: (task: Task) => void; onToggleTask: (id: string) => void; onRemoveTask: (task: Task) => void;
  /** Opens the task form for a new step at the end of this program. */
  onAddStep?: (program: TaskProgram) => void;
};

/** "It also opened for 3 participants who had finished the program." */
export function reopenedNotice(count: number) {
  return count > 0 ? ` Он открылся и ${count} ${plural(count, "участнику", "участникам", "участникам")}, ${count === 1 ? "который уже прошёл" : "которые уже прошли"} программу.` : "";
}

export function ProgramsPanel({ programs, tasks, actorId, canManageAll, history = [], taskBusyId, onChange, onError, onEditTask, onToggleTask, onRemoveTask, onAddStep }: Props) {
  const customPrograms = programs.filter((program) => !program.templateKey).sort(comparePublications);
  const [busyId, setBusyId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskProgram | null>(null);
  const [gamePicker, setGamePicker] = useState<TaskProgram | null>(null);

  async function addGame(program: TaskProgram) {
    if (busyId) return;
    setBusyId(program.id);
    try {
      const { task, reopened } = await addProgramGame(program.id, FIRST_YEAR_KIND);
      onChange(programs, [...tasks.filter((item) => item.id !== task.id), task]);
      setGamePicker(null);
      onError(`Игра «${FIRST_YEAR_TITLE}» добавлена последним шагом. Стрелками ↑ ↓ её можно переставить.${reopenedNotice(reopened)}`);
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось добавить игру."); }
    finally { setBusyId(""); }
  }

  // Shows the new order at once and saves it; on a failure the previous order comes back.
  async function move(program: TaskProgram, steps: Task[], task: Task, step: -1 | 1) {
    const from = steps.findIndex((item) => item.id === task.id), to = from + step;
    if (busyId || from < 0 || to < 0 || to >= steps.length) return;
    const ordered = [...steps];
    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    const positions = new Map(ordered.map((item, index) => [item.id, index + 1]));
    const previous = tasks;
    onChange(programs, tasks.map((item) => positions.has(item.id) ? { ...item, position: positions.get(item.id) } : item));
    setBusyId(program.id);
    try { await reorderProgramSteps(program.id, ordered.map((item) => item.id)); }
    catch (error) { onChange(programs, previous); onError(error instanceof Error ? error.message : "Не удалось сохранить порядок."); }
    finally { setBusyId(""); }
  }

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
    <p className="admin-muted">Участник проходит шаги по порядку: следующий открывается, когда предыдущий принят. Нажмите на программу, чтобы увидеть шаги и кто на каком шаге.</p>
    {customPrograms.length === 0 ? <div className="admin-panel"><div className="empty-admin"><p>Программ пока нет. Создайте первую программу.</p></div></div> : <div className={styles.list}>
      {customPrograms.map((program) => {
        const canManage = canManageAll || program.publisherId === actorId;
        const steps = tasks.filter((task) => task.programId === program.id).sort((a, b) => (a.position || 0) - (b.position || 0) || a.id.localeCompare(b.id));
        const isExpanded = expanded === program.id;
        const progress = history.find((item) => item.id === program.id);
        const funnel = programFunnel(progress, steps);
        const busy = Boolean(taskBusyId || busyId);
        return <section key={program.id} className={[styles.card, program.isActive ? "" : styles.cardHidden, isExpanded ? styles.cardOpen : ""].join(" ")}>
          <button type="button" className={styles.cardHead} aria-expanded={isExpanded} aria-controls={"program-steps-" + program.id} onClick={() => setExpanded(isExpanded ? null : program.id)}>
            <span className={styles.headMain}>
              <span className={styles.badges}>
                <span className={program.isActive ? styles.badgeOn : styles.badgeOff}>{program.isActive ? "Активна" : "Скрыта"}</span>
                {program.isPinned && <span className={styles.badgePin}>Закреплена</span>}
              </span>
              <strong className={styles.cardTitle}>{program.title}</strong>
              <span className={styles.facts}>{steps.length} {plural(steps.length, "шаг", "шага", "шагов")} · {program.deadlineHours} ч на шаг · до {formatMiles(steps.reduce((total, task) => total + task.maxPoints, 0))}</span>
              {progress && <span className={styles.people}>{funnel.total ? `${funnel.total} ${plural(funnel.total, "участник", "участника", "участников")} в программе · ${funnel.completed} ${plural(funnel.completed, "прошёл", "прошли", "прошли")} до конца` : "Пока никто не начал"}</span>}
            </span>
            <span className={styles.chevron} aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></span>
          </button>
          {isExpanded && <div id={"program-steps-" + program.id} className={styles.body}>
            <div className={styles.bodyHead}><strong>Шаги по порядку</strong>{progress && funnel.total > 0 && <span>полоска — сколько участников сейчас на шаге</span>}</div>
            {steps.length === 0 ? <p className={styles.emptySteps}>В программе пока нет шагов.</p> : <ol className={styles.timeline}>
              {steps.map((task, index) => {
                const count = funnel.rows[index]?.count || 0;
                const max = Math.max(1, funnel.completed, ...funnel.rows.map((row) => row.count));
                const canEditStep = canManageAll || task.publisherId === actorId;
                return <li key={task.id} className={[styles.step, task.isActive ? "" : styles.stepHidden].join(" ")}>
                  <span className={styles.stepNum} aria-hidden="true">{index + 1}</span>
                  <div className={styles.stepBody}>
                    <strong>{task.title}</strong>
                    <span className={styles.stepMeta}>
                      <span>до {formatMiles(task.maxPoints)}</span>
                      {task.interactiveKind && <span className={styles.tagGame}>игра · без срока</span>}
                      {task.video && <span className={styles.tag}>видео</span>}
                      {task.quiz && <span className={styles.tag}>вопросы</span>}
                      {Boolean(task.attachments?.length) && <span className={styles.tag}>PDF</span>}
                      {!task.isActive && <span className={styles.tagHidden}>скрыт от участников</span>}
                    </span>
                    {progress && funnel.total > 0 && <span className={styles.stepNow}>
                      <i className={styles.bar} aria-hidden="true"><i style={{ width: `${(count / max) * 100}%` }} /></i>
                      <span>{count ? `сейчас здесь ${count}` : "сейчас никого"}</span>
                    </span>}
                  </div>
                  {canEditStep && <div className={styles.tools}>
                    {canManage && <span className={styles.moveGroup}>
                      <button type="button" className={styles.tool} disabled={busy || index === 0} onClick={() => void move(program, steps, task, -1)} aria-label={`Поднять «${task.title}» выше`} title="Выше">↑</button>
                      <button type="button" className={styles.tool} disabled={busy || index === steps.length - 1} onClick={() => void move(program, steps, task, 1)} aria-label={`Опустить «${task.title}» ниже`} title="Ниже">↓</button>
                    </span>}
                    <span className={styles.actionGroup}>
                      {!task.interactiveKind && <button type="button" className={`${styles.tool} ${styles.toolEdit}`} disabled={busy} onClick={() => onEditTask(task)} aria-label={`Изменить «${task.title}»`}>{actionIcons.edit}<span>Изменить</span></button>}
                      <button type="button" className={`${styles.tool} ${styles.toolLabel}`} disabled={busy} onClick={() => onToggleTask(task.id)} aria-label={`${task.isActive ? "Скрыть" : "Показать"} «${task.title}»`} title={task.isActive ? "Скрыть от участников" : "Показать участникам"}>{task.isActive ? actionIcons.hide : actionIcons.show}<span>{task.isActive ? "Скрыть" : "Показать"}</span></button>
                      <button type="button" className={`${styles.tool} ${styles.toolLabel} ${styles.toolDanger}`} disabled={busy} onClick={() => onRemoveTask(task)} aria-label={`Удалить «${task.title}»`} title="Удалить шаг">{actionIcons.remove}<span>Удалить</span></button>
                    </span>
                  </div>}
                </li>;
              })}
              {progress && funnel.total > 0 && <li className={`${styles.step} ${styles.stepDone}`}>
                <span className={styles.stepNum} aria-hidden="true">✓</span>
                <div className={styles.stepBody}>
                  <strong>Прошли программу</strong>
                  <span className={styles.stepNow}>
                    <i className={styles.bar} aria-hidden="true"><i style={{ width: `${(funnel.completed / Math.max(1, funnel.completed, ...funnel.rows.map((row) => row.count))) * 100}%` }} /></i>
                    <span>{funnel.completed} из {funnel.total}</span>
                  </span>
                </div>
              </li>}
            </ol>}
            {canManage && <div className={styles.addRow}>
              {onAddStep && <button type="button" className={styles.addStep} disabled={busy} onClick={() => onAddStep(program)}>＋ Добавить шаг</button>}
              <button type="button" className={styles.addGame} disabled={busy} onClick={() => setGamePicker(program)}>＋ Добавить готовую игру</button>
            </div>}
            {canManage && <div className={styles.programActions}>
              <span>Вся программа</span>
              <div>
                <button type="button" className={styles.programAction} disabled={busy} onClick={() => void update(program, { isPinned: !program.isPinned })} aria-pressed={Boolean(program.isPinned)}>{program.isPinned ? "Открепить" : "Закрепить сверху"}</button>
                <button type="button" className={styles.programAction} disabled={busy} onClick={() => void update(program, { isActive: !program.isActive })}>{program.isActive ? <>{actionIcons.hide}Скрыть</> : <>{actionIcons.show}Показать</>}</button>
                <button type="button" className={`${styles.programAction} ${styles.toolDanger}`} disabled={busy} onClick={() => setDeleteTarget(program)}>{actionIcons.remove}Удалить</button>
              </div>
            </div>}
          </div>}
        </section>;
      })}
    </div>}
    {gamePicker && <ModalSheet title="Готовая игра в программу" onClose={() => { if (!busyId) setGamePicker(null); }}>
      <div className={styles.gameCatalog}>
        <p>Игра встанет последним шагом программы «{gamePicker.title}». Срока у неё нет, мили начисляются сразу после прохождения, и участнику открывается следующий шаг. Тем, кто уже прошёл программу, игра тоже откроется.</p>
        {(() => {
          const added = tasks.some((task) => task.programId === gamePicker.id && task.interactiveKind === FIRST_YEAR_KIND);
          return <article className={styles.gameCard}>
            <span aria-hidden="true">⚓</span>
            <div><strong>{FIRST_YEAR_TITLE}</strong><p>{FIRST_YEAR_DESCRIPTION}</p><small>{FIRST_YEAR_REWARD} мили за прохождение · без срока · около 7 минут</small></div>
            <button type="button" className="button button-primary" disabled={Boolean(busyId) || added} onClick={() => void addGame(gamePicker)}>{added ? "Уже в программе" : busyId ? "Добавляем…" : "Добавить"}</button>
          </article>;
        })()}
      </div>
    </ModalSheet>}
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
