"use client";

import { useState } from "react";
import { createAdminProgram, deleteAdminProgram, updateAdminProgram } from "@/frontend/shared/api/admin-client";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import type { Task, TaskProgram } from "@/shared/domain/types";

type DraftTask = { title: string; description: string; resourceUrl: string; maxPoints: string };
const emptyTask = (): DraftTask => ({ title: "", description: "", resourceUrl: "", maxPoints: "10" });

export function ProgramsPanel({ programs, tasks, actorId, canManageAll, onChange, onError }: { programs: TaskProgram[]; tasks: Task[]; actorId: string; canManageAll: boolean; onChange: (programs: TaskProgram[], tasks: Task[]) => void; onError: (message: string) => void }) {
  const [title, setTitle] = useState("");
  const [deadlineHours, setDeadlineHours] = useState("72");
  const [draftTasks, setDraftTasks] = useState<DraftTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaskProgram | null>(null);
  const hasInvalidStep = draftTasks.some((task) => task.title.trim().length < 2 || task.description.trim().length < 2 || !Number.isInteger(Number(task.maxPoints)) || Number(task.maxPoints) < 0 || Number(task.maxPoints) > 100);
  const canPublish = title.trim().length >= 2 && Number.isInteger(Number(deadlineHours)) && Number(deadlineHours) >= 1 && Number(deadlineHours) <= 720 && draftTasks.length > 0 && !hasInvalidStep;

  function updateTask(index: number, key: keyof DraftTask, value: string) {
    setDraftTasks((current) => current.map((task, itemIndex) => itemIndex === index ? { ...task, [key]: value } : task));
  }
  async function publish() {
    const cleanTitle = title.trim(); const hours = Number(deadlineHours);
    if (cleanTitle.length < 2) { onError("Укажите название программы."); return; }
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) { onError("Интервал должен быть от 1 до 720 часов."); return; }
    if (draftTasks.length === 0) { onError("Добавьте хотя бы один шаг программы перед публикацией."); return; }
    if (hasInvalidStep) { onError("Заполните все шаги программы и проверьте количество баллов."); return; }
    setBusy(true);
    try {
      const created = await createAdminProgram({ title: cleanTitle, deadlineHours: hours, tasks: draftTasks.map((task) => ({ title: task.title.trim(), description: task.description.trim(), resourceUrl: task.resourceUrl.trim() || null, maxPoints: Number(task.maxPoints) })) });
      onChange([created.program, ...programs], [...created.tasks, ...tasks]);
      setTitle(""); setDraftTasks([]); onError("Программа опубликована. Первый шаг уже доступен участникам.");
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось создать программу."); }
    finally { setBusy(false); }
  }
  async function toggle(program: TaskProgram) {
    try {
      const updated = await updateAdminProgram(program.id, { isActive: !program.isActive });
      onChange(programs.map((item) => item.id === updated.id ? updated : item), tasks.map((task) => task.programId === program.id ? { ...task, isActive: updated.isActive } : task));
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось изменить программу."); }
  }
  async function remove() {
    if (!deleteTarget) return;
    const program = deleteTarget;
    setBusy(true);
    try {
      await deleteAdminProgram(program.id);
      onChange(programs.filter((item) => item.id !== program.id), tasks.filter((task) => task.programId !== program.id));
      onError("Программа и её шаги удалены.");
      setDeleteTarget(null);
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось удалить программу."); }
    finally { setBusy(false); }
  }

  return <div className="programs-panel">
    <div className="admin-panel program-builder">
      <div className="panel-title"><div><p className="eyebrow">Последовательное обучение</p><h2>Новая программа</h2></div><span className="program-rule">Шаги открываются по очереди</span></div>
      <div className="form-two-columns"><label>Название программы<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, Старт новичка" /></label><label>Срок на каждый шаг, часов<input type="number" min="1" max="720" value={deadlineHours} onChange={(event) => setDeadlineHours(event.target.value)} /></label></div>
      <div className="program-steps-heading"><div><p className="eyebrow">Содержание</p><h3>Шаги программы</h3></div><span>{draftTasks.length} {draftTasks.length === 1 ? "шаг" : "шагов"}</span></div>
      {draftTasks.length === 0 ? <div className="program-empty-steps"><span>＋</span><div><strong>Добавьте первый шаг</strong><p>Публикация станет доступна после добавления хотя бы одного заполненного шага.</p></div><button type="button" className="button button-primary" onClick={() => setDraftTasks([emptyTask()])}>Добавить первый шаг</button></div> : <div className="program-step-editor">{draftTasks.map((task, index) => <div className="program-step" key={index}><div className="program-step-head"><div><span>Этап {String(index + 1).padStart(2, "0")}</span><strong>Шаг {index + 1}</strong></div><button type="button" className="button button-danger button-small" onClick={() => setDraftTasks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Удалить</button></div><label>Название шага<input value={task.title} onChange={(event) => updateTask(index, "title", event.target.value)} placeholder="Например, Познакомиться с командой" /></label><label>Описание<textarea rows={3} value={task.description} onChange={(event) => updateTask(index, "description", event.target.value)} placeholder="Опишите результат, который должен получить участник" /></label><div className="form-two-columns"><label>Максимум баллов<input type="number" min="0" max="100" value={task.maxPoints} onChange={(event) => updateTask(index, "maxPoints", event.target.value)} /></label><label>Ссылка на материал <span className="field-hint">необязательно</span><input type="url" value={task.resourceUrl} onChange={(event) => updateTask(index, "resourceUrl", event.target.value)} placeholder="https://youtube.com/..." /></label></div></div>)}</div>}
      <div className="program-builder-actions"><button type="button" className="button button-edit" onClick={() => setDraftTasks((current) => [...current, emptyTask()])}>＋ Добавить шаг</button><button type="button" className="button button-primary" disabled={busy || !canPublish} onClick={() => { void publish(); }}>{busy ? "Публикуем..." : "Опубликовать программу"}</button></div>
    </div>
    <div className="admin-panel table-panel"><div className="panel-title"><div><p className="eyebrow">Опубликованные</p><h2>Программы команды</h2></div></div>{programs.length === 0 ? <div className="empty-admin"><p>Программ пока нет.</p></div> : programs.map((program) => { const canManage = canManageAll || program.publisherId === actorId; return <div className="program-row" key={program.id}><div><strong>{program.title}</strong><span>{tasks.filter((task) => task.programId === program.id).length} шагов · {program.deadlineHours} ч на шаг</span></div><span className={"admin-status " + (program.isActive ? "active" : "inactive")}>{program.isActive ? "Активна" : "Скрыта"}</span>{canManage && <div className="row-actions"><button className={"button " + (program.isActive ? "button-warning" : "button-success")} onClick={() => { void toggle(program); }} disabled={busy}>{program.isActive ? "Скрыть" : "Активировать"}</button><button className="button button-danger" onClick={() => setDeleteTarget(program)} disabled={busy}>Удалить</button></div>}</div>; })}</div>
    {deleteTarget && <ConfirmModal title="Удалить программу?" description={<>«{deleteTarget.title}», все её шаги и отправленные работы будут удалены без возможности восстановления.</>} confirmLabel="Удалить программу" busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={() => { void remove(); }} />}
  </div>;
}
