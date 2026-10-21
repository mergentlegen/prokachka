"use client";

import { useState } from "react";
import { addProgramGame, deleteAdminProgram, reorderProgramSteps, updateAdminProgram } from "@/frontend/shared/api/admin-client";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { PROGRAM_GAMES, type ProgramGame } from "@/shared/domain/program-games";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import { FormSheet } from "@/frontend/shared/FormSheet";
import { Drawer, staggerStyle } from "@/frontend/shared/Drawer";
import { ActionsMenu, pinIcon, type MenuItem } from "./AdminTasksView";
import { actionIcons } from "./AdminIcons";
import { comparePublications } from "@/shared/domain/publication-order";
import { formatMiles } from "@/frontend/shared/lib/format";
import type { Task, TaskProgram } from "@/shared/domain/types";
import type { ProgramHistory } from "@/shared/domain/history";
import { plural } from "@/frontend/shared/lib/plural";
import { LEVELS } from "@/shared/domain/levels";
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
  const [ordering, setOrdering] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TaskProgram | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function addGame(program: TaskProgram, game: ProgramGame) {
    if (busyId) return;
    setBusyId(program.id);
    try {
      const { task, reopened } = await addProgramGame(program.id, game.kind);
      onChange(programs, [...tasks.filter((item) => item.id !== task.id), task]);
      setGamePicker(null);
      onError(`Игра «${game.title}» добавлена последним шагом. Стрелками ↑ ↓ её можно переставить.${reopenedNotice(reopened)}`);
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

  async function update(program: TaskProgram, patch: { title?: string; isActive?: boolean; isPinned?: boolean; level?: number }) {
    if (busyId) return false;
    setBusyId(program.id);
    try {
      const updated = await updateAdminProgram(program.id, patch);
      // The steps follow the program to its new level.
      const moved = patch.level === undefined ? tasks : tasks.map((task) => task.programId === program.id ? { ...task, level: patch.level && patch.level > 1 ? patch.level : undefined } : task);
      onChange(programs.map((item) => item.id === updated.id ? updated : item), moved);
      return true;
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось изменить программу."); return false; }
    finally { setBusyId(""); }
  }

  // Participants see the new name at once: in their program blocks and on every step card.
  async function rename() {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (title === renameTarget.title) { setRenameTarget(null); return; }
    if (await update(renameTarget, { title })) { setRenameTarget(null); onError("Название программы сохранено."); }
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

  // One program as a card: a short header with its own ⋯ menu, and the steps folding out below it.
  const programCard = (program: TaskProgram, position: number) => {
    const canManage = canManageAll || program.publisherId === actorId;
    const steps = tasks.filter((task) => task.programId === program.id).sort((a, b) => (a.position || 0) - (b.position || 0) || a.id.localeCompare(b.id));
    const isExpanded = expanded === program.id;
    const progress = history.find((item) => item.id === program.id);
    const funnel = programFunnel(progress, steps);
    const busy = Boolean(taskBusyId || busyId);
    const reordering = ordering === program.id;
    const programItems: MenuItem[] = canManage ? [
      { label: "Переименовать", icon: actionIcons.edit, onSelect: () => { setRenameValue(program.title); setRenameTarget(program); } },
      { label: program.isPinned ? "Открепить" : "Закрепить сверху", icon: pinIcon, onSelect: () => void update(program, { isPinned: !program.isPinned }) },
      { label: program.isActive ? "Скрыть от участников" : "Показать участникам", icon: program.isActive ? actionIcons.hide : actionIcons.show, onSelect: () => void update(program, { isActive: !program.isActive }) },
      ...LEVELS.filter((level) => level !== (program.level ?? 1) && !program.templateKey).map((level) => ({ label: `Перенести на уровень ${level}`, icon: actionIcons.show,
        onSelect: () => void update(program, { level }).then((done) => { if (done) onError(`Программа «${program.title}» теперь для уровня ${level}.`); }) })),
      { label: "Удалить программу", icon: actionIcons.remove, danger: true, onSelect: () => setDeleteTarget(program) },
    ] : [];
    return <section key={program.id} className={[styles.card, program.isActive ? "" : styles.cardHidden, isExpanded ? styles.cardOpen : ""].join(" ")} data-stagger style={staggerStyle(position)}>
      <div className={styles.cardTop}>
        <button type="button" className={styles.cardHead} aria-expanded={isExpanded} aria-controls={"program-steps-" + program.id} onClick={() => { setOrdering(null); setAdding(null); setExpanded(isExpanded ? null : program.id); }}>
          <span className={styles.headMain}>
            <span className={styles.badges}>
              <span className={program.isActive ? styles.badgeOn : styles.badgeOff}>{program.isActive ? "Активна" : "Скрыта"}</span>
              {program.isPinned && <span className={styles.badgePin}>{pinIcon}Закреплена</span>}
              {(program.level ?? 1) > 1 && <span className={styles.badgeLevel}>Уровень {program.level}</span>}
            </span>
            <strong className={styles.cardTitle}>{program.title}</strong>
            <span className={styles.facts}>{steps.length} {plural(steps.length, "шаг", "шага", "шагов")} · {program.deadlineHours} ч на шаг · до {formatMiles(steps.reduce((total, task) => total + task.maxPoints, 0))}</span>
            {progress && <span className={styles.people}>{funnel.total ? `${funnel.total} ${plural(funnel.total, "участник", "участника", "участников")} в программе · ${funnel.completed} ${plural(funnel.completed, "прошёл", "прошли", "прошли")} до конца` : "Пока никто не начал"}</span>}
          </span>
          <span className={styles.chevron} aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></span>
        </button>
        {programItems.length > 0 && <div className={styles.cardMenu}><ActionsMenu title={program.title} items={programItems} disabled={busy} /></div>}
      </div>
      <Drawer open={isExpanded} id={"program-steps-" + program.id}><div className={styles.body}>
        <div className={styles.bodyHead}>
          <strong>Шаги по порядку</strong>
          {canManage && steps.length > 1 && <button type="button" className={`${styles.orderToggle} ${reordering ? styles.orderOn : ""}`} aria-pressed={reordering} disabled={busy && !reordering} onClick={() => setOrdering(reordering ? null : program.id)}>{reordering ? "Готово" : "↕ Изменить порядок"}</button>}
        </div>
        {steps.length === 0 ? <p className={styles.emptySteps}>В программе пока нет шагов.</p> : <ol className={styles.timeline}>
          {steps.map((task, index) => {
            const count = funnel.rows[index]?.count || 0;
            const canEditStep = canManageAll || task.publisherId === actorId;
            const stepItems: MenuItem[] = [
              ...(!task.interactiveKind ? [{ label: "Изменить", icon: actionIcons.edit, onSelect: () => onEditTask(task) }] : []),
              { label: task.isActive ? "Скрыть от участников" : "Показать участникам", icon: task.isActive ? actionIcons.hide : actionIcons.show, onSelect: () => onToggleTask(task.id) },
              { label: "Удалить шаг", icon: actionIcons.remove, danger: true, onSelect: () => onRemoveTask(task) },
            ];
            return <li key={task.id} className={[styles.step, task.isActive ? "" : styles.stepHidden].join(" ")} data-stagger style={staggerStyle(index)}>
              <span className={styles.stepNum} aria-hidden="true">{index + 1}</span>
              <div className={styles.stepBody}>
                <strong>{task.title}</strong>
                <span className={styles.stepMeta}>
                  <span>до {formatMiles(task.maxPoints)}</span>
                  {task.interactiveKind && <span className={styles.tagGame}>игра · без срока</span>}
                  {task.video && <span className={styles.tag}>видео</span>}
                  {task.quiz && <span className={styles.tag}>тест</span>}
                  {task.voiceAnswer && <span className={styles.tag}>голосовое</span>}
                  {Boolean(task.attachments?.length) && <span className={styles.tag}>PDF</span>}
                  {!task.isActive && <span className={styles.tagHidden}>скрыт</span>}
                  {progress && count > 0 && <span className={styles.here}>сейчас здесь: {count}</span>}
                </span>
              </div>
              {canEditStep && (reordering
                ? <span className={styles.moveGroup}>
                  <button type="button" className={styles.tool} disabled={busy || index === 0} onClick={() => void move(program, steps, task, -1)} aria-label={`Поднять «${task.title}» выше`}>↑</button>
                  <button type="button" className={styles.tool} disabled={busy || index === steps.length - 1} onClick={() => void move(program, steps, task, 1)} aria-label={`Опустить «${task.title}» ниже`}>↓</button>
                </span>
                : <ActionsMenu title={task.title} items={stepItems} disabled={busy} />)}
            </li>;
          })}
          {progress && funnel.total > 0 && <li className={`${styles.step} ${styles.stepDone}`} data-stagger style={staggerStyle(steps.length)}>
            <span className={styles.stepNum} aria-hidden="true">✓</span>
            <div className={styles.stepBody}><strong>Прошли программу</strong><span className={styles.stepMeta}><span className={styles.hereDone}>{funnel.completed} из {funnel.total}</span></span></div>
          </li>}
        </ol>}
        {canManage && !reordering && <div className={styles.addArea}>
          <button type="button" className={styles.addStep} disabled={busy} aria-expanded={adding === program.id} onClick={() => setAdding(adding === program.id ? null : program.id)}>＋ Добавить шаг</button>
          <Drawer open={adding === program.id}><div className={styles.addChoices}>
            {onAddStep && <button type="button" className={styles.addChoice} disabled={busy} onClick={() => { setAdding(null); onAddStep(program); }}><strong>Обычное задание</strong><small>Текст, ссылка, видео, PDF или тест</small></button>}
            <button type="button" className={styles.addChoice} disabled={busy} onClick={() => { setAdding(null); setGamePicker(program); }}><strong>Готовая игра</strong><small>Мили начисляются сразу после прохождения</small></button>
          </div></Drawer>
        </div>}
      </div></Drawer>
    </section>;
  };
  const activePrograms = customPrograms.filter((program) => program.isActive);
  const hiddenPrograms = customPrograms.filter((program) => !program.isActive);

  return <>
    <p className="admin-muted">Участник проходит шаги по порядку: следующий открывается, когда предыдущий принят. Нажмите на программу, чтобы увидеть шаги и кто на каком шаге.</p>
    {customPrograms.length === 0 ? <div className="admin-panel"><div className="empty-admin"><p>Программ пока нет. Создайте первую программу.</p></div></div> : <div className={styles.list}>
      {activePrograms.length ? activePrograms.map(programCard) : <p className={styles.emptySteps}>Активных программ нет. Покажите скрытую или создайте новую.</p>}
      {hiddenPrograms.length > 0 && <>
        <button type="button" className={styles.fold} aria-expanded={hiddenOpen} onClick={() => setHiddenOpen(!hiddenOpen)}>Скрытые <span>{hiddenPrograms.length}</span><i aria-hidden="true" /></button>
        <Drawer open={hiddenOpen}><div className={styles.list}>{hiddenPrograms.map(programCard)}</div></Drawer>
      </>}
    </div>}
    {gamePicker && <ModalSheet title="Готовая игра в программу" onClose={() => { if (!busyId) setGamePicker(null); }}>
      <div className={styles.gameCatalog}>
        <p>Игра встанет последним шагом программы «{gamePicker.title}». Срока у неё нет, мили начисляются сразу после прохождения, и участнику открывается следующий шаг. Тем, кто уже прошёл программу, игра тоже откроется.</p>
        {PROGRAM_GAMES.map((game) => {
          const added = tasks.some((task) => task.programId === gamePicker.id && task.interactiveKind === game.kind);
          return <article key={game.kind} className={styles.gameCard}>
            <span aria-hidden="true">{game.icon}</span>
            <div><strong>{game.title}</strong><p>{game.description}</p><small>{formatMiles(game.reward)} за прохождение · без срока · около {game.minutes} минут</small></div>
            <button type="button" className="button button-primary" disabled={Boolean(busyId) || added} onClick={() => void addGame(gamePicker, game)}>{added ? "Уже в программе" : busyId ? "Добавляем…" : "Добавить"}</button>
          </article>;
        })}
      </div>
    </ModalSheet>}
    {renameTarget && <FormSheet title="Название программы" submitLabel="Сохранить" busy={Boolean(busyId)} submitDisabled={renameValue.trim().length < 2}
      intro="Участники сразу увидят новое название. Шаги, прогресс и мили не меняются." onClose={() => setRenameTarget(null)} onSubmit={() => void rename()}>
      <label>Название<input id="program-rename" value={renameValue} maxLength={160} onChange={(event) => setRenameValue(event.target.value)} autoFocus /></label>
    </FormSheet>}
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
