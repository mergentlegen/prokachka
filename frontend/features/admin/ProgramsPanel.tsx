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
  const [draftTasks, setDraftTasks] = useState<DraftTask[]>([emptyTask()]);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaskProgram | null>(null);

  function updateTask(index: number, key: keyof DraftTask, value: string) {
    setDraftTasks((current) => current.map((task, itemIndex) => itemIndex === index ? { ...task, [key]: value } : task));
  }
  async function publish() {
    const cleanTitle = title.trim(); const hours = Number(deadlineHours);
    if (cleanTitle.length < 2) { onError("Укажите название программы."); return; }
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) { onError("Интервал должен быть от 1 до 720 часов."); return; }
    if (draftTasks.some((task) => task.title.trim().length < 2 || task.description.trim().length < 2 || !Number.isInteger(Number(task.maxPoints)))) { onError("Заполните все шаги программы."); return; }
    setBusy(true);
    try {
      const created = await createAdminProgram({ title: cleanTitle, deadlineHours: hours, tasks: draftTasks.map((task) => ({ title: task.title.trim(), description: task.description.trim(), resourceUrl: task.resourceUrl.trim() || null, maxPoints: Number(task.maxPoints) })) });
      onChange([created.program, ...programs], [...created.tasks, ...tasks]);
      setTitle(""); setDraftTasks([emptyTask()]); onError("Программа опубликована. Первый шаг уже доступен участникам.");
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
      <div className="program-resource-editor">
        <div className="program-resource-heading"><strong>Ссылки на материалы</strong><span>Добавьте видео или полезный ресурс для каждого шага</span></div>
        {draftTasks.map((task, index) => <label key={index}>Шаг {index + 1}<input type="url" value={task.resourceUrl} onChange={(event) => updateTask(index, "resourceUrl", event.target.value)} placeholder="https://youtube.com/..." /></label>)}
      </div>
      <div className="panel-title"><div><p className="eyebrow">Последовательное обучение</p><h2>Новая программа</h2></div><span className="program-rule">Шаги открываются по очереди</span></div>
      <div className="form-two-columns"><label>Название программы<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, Старт новичка" /></label><label>Срок на каждый шаг, часов<input type="number" min="1" max="720" value={deadlineHours} onChange={(event) => setDeadlineHours(event.target.value)} /></label></div>
      <div className="program-step-editor">{draftTasks.map((task, index) => <div className="program-step" key={index}><div className="program-step-head"><strong>Шаг {index + 1}</strong>{draftTasks.length > 1 && <button type="button" className="button button-danger button-small" onClick={() => setDraftTasks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Удалить</button>}</div><label>Название шага<input value={task.title} onChange={(event) => updateTask(index, "title", event.target.value)} /></label><label>Описание<textarea rows={3} value={task.description} onChange={(event) => updateTask(index, "description", event.target.value)} /></label><label>Максимум баллов<input type="number" min="0" max="100" value={task.maxPoints} onChange={(event) => updateTask(index, "maxPoints", event.target.value)} /></label></div>)}</div>
      <div className="modal-actions"><button type="button" className="button button-muted" onClick={() => setDraftTasks((current) => [...current, emptyTask()])}>+ Добавить шаг</button><button type="button" className="button button-primary" disabled={busy} onClick={() => { void publish(); }}>{busy ? "Публикуем..." : "Опубликовать программу"}</button></div>
    </div>
    <div className="admin-panel table-panel"><div className="panel-title"><div><p className="eyebrow">Опубликованные</p><h2>Программы команды</h2></div></div>{programs.length === 0 ? <div className="empty-admin"><p>Программ пока нет.</p></div> : programs.map((program) => { const canManage = canManageAll || program.publisherId === actorId; return <div className="program-row" key={program.id}><div><strong>{program.title}</strong><span>{tasks.filter((task) => task.programId === program.id).length} шагов · {program.deadlineHours} ч на шаг</span></div><span className={"admin-status " + (program.isActive ? "active" : "inactive")}>{program.isActive ? "Активна" : "Скрыта"}</span>{canManage && <div className="row-actions"><button className={"button " + (program.isActive ? "button-warning" : "button-success")} onClick={() => { void toggle(program); }} disabled={busy}>{program.isActive ? "Скрыть" : "Активировать"}</button><button className="button button-danger" onClick={() => setDeleteTarget(program)} disabled={busy}>Удалить</button></div>}</div>; })}</div>
    {deleteTarget && <ConfirmModal title="Удалить программу?" description={<>«{deleteTarget.title}», все её шаги и отправленные работы будут удалены без возможности восстановления.</>} confirmLabel="Удалить программу" busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={() => { void remove(); }} />}
  </div>;
}
