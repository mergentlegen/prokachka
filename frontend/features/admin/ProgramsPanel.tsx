"use client";

import { useEffect, useRef, useState } from "react";
import { createAdminProgram, deleteAdminProgram, updateAdminProgram } from "@/frontend/shared/api/admin-client";
import { uploadTaskAttachment } from "@/frontend/shared/api/client";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import type { Task, TaskProgram } from "@/shared/domain/types";
import { ResourceCard } from "@/frontend/shared/ResourceCard";
import { formatMiles } from "@/frontend/shared/lib/format";
import { ReadyProgramsPanel } from "./ReadyProgramsPanel";
import styles from "./ProgramsPanel.module.css";

type DraftTask = { id: number; title: string; description: string; resourceUrl: string; maxPoints: string; files: File[] };
function validLink(value: string) {
  if (!value.trim()) return true;
  try { return value.trim().length <= 2000 && ["http:", "https:"].includes(new URL(value.trim()).protocol); }
  catch { return false; }
}

export function ProgramsPanel({ programs, tasks, actorId, canManageAll, onChange, onError }: { programs: TaskProgram[]; tasks: Task[]; actorId: string; canManageAll: boolean; onChange: (programs: TaskProgram[], tasks: Task[]) => void; onError: (message: string) => void }) {
  const [title, setTitle] = useState("");
  const [deadlineHours, setDeadlineHours] = useState("72");
  const [draftTasks, setDraftTasks] = useState<DraftTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaskProgram | null>(null);
  const nextId = useRef(0);
  const newStepInput = useRef<HTMLInputElement>(null);
  const focusNewStep = useRef(false);
  const reviewTitle = useRef<HTMLHeadingElement>(null);
  const hasInvalidStep = draftTasks.some((task) =>
    task.title.trim().length < 2 || task.title.trim().length > 160 ||
    task.description.trim().length < 2 || task.description.trim().length > 5000 ||
    !task.maxPoints.trim() || !Number.isInteger(Number(task.maxPoints)) || Number(task.maxPoints) < 0 || Number(task.maxPoints) > 100 || !validLink(task.resourceUrl));
  const canPublish = title.trim().length >= 2 && title.trim().length <= 160 &&
    Number.isInteger(Number(deadlineHours)) && Number(deadlineHours) >= 1 && Number(deadlineHours) <= 720 &&
    draftTasks.length > 0 && draftTasks.length <= 100 && !hasInvalidStep;

  useEffect(() => {
    if (focusNewStep.current) { newStepInput.current?.focus(); focusNewStep.current = false; }
  }, [draftTasks.length]);
  useEffect(() => { if (preview) reviewTitle.current?.focus(); }, [preview]);

  function addStep() {
    if (busy || draftTasks.length >= 100) return;
    focusNewStep.current = true;
    const task = { id: nextId.current++, title: "", description: "", resourceUrl: "", maxPoints: "10", files: [] };
    setDraftTasks((current) => [...current, task]);
  }
  function updateTask<K extends keyof Omit<DraftTask, "id">>(id: number, key: K, value: DraftTask[K]) {
    setDraftTasks((current) => current.map((task) => task.id === id ? { ...task, [key]: value } : task));
  }
  async function publish() {
    if (busy || !canPublish || !preview) return;
    setBusy(true);
    try {
      const created = await createAdminProgram({
        title: title.trim(), deadlineHours: Number(deadlineHours),
        tasks: draftTasks.map((task) => ({ title: task.title.trim(), description: task.description.trim(), resourceUrl: task.resourceUrl.trim() || null, maxPoints: Number(task.maxPoints) })),
      });
      const tasksWithFiles = [...created.tasks];
      const uploadErrors: string[] = [];
      for (let index = 0; index < draftTasks.length; index += 1) {
        const task = tasksWithFiles.find((item) => item.position === index + 1) || tasksWithFiles[index];
        if (!task) continue;
        for (const file of draftTasks[index].files) {
          try {
            const attachment = await uploadTaskAttachment(task.id, file);
            const taskIndex = tasksWithFiles.findIndex((item) => item.id === task.id);
            tasksWithFiles[taskIndex] = { ...tasksWithFiles[taskIndex], attachments: [...(tasksWithFiles[taskIndex].attachments || []), attachment] };
          } catch { uploadErrors.push(file.name); }
        }
      }
      onChange([created.program, ...programs], [...tasksWithFiles, ...tasks]);
      setTitle(""); setDraftTasks([]); setPreview(false);
      onError(uploadErrors.length ? `Программа опубликована, но не загрузились PDF: ${uploadErrors.join(", ")}. Их можно добавить позже через редактирование соответствующих заданий.` : "Программа опубликована. Первый шаг уже доступен участникам.");
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось создать программу."); }
    finally { setBusy(false); }
  }
  async function toggle(program: TaskProgram) {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await updateAdminProgram(program.id, { isActive: !program.isActive });
      onChange(programs.map((item) => item.id === updated.id ? updated : item), tasks.map((task) => task.programId === program.id ? { ...task, isActive: updated.isActive } : task));
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось изменить программу."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleteTarget || busy) return;
    const program = deleteTarget;
    setBusy(true);
    try {
      const cleanupWarning = await deleteAdminProgram(program.id);
      onChange(programs.filter((item) => item.id !== program.id), tasks.filter((task) => task.programId !== program.id));
      onError(cleanupWarning ? "Программа и шаги удалены, но часть PDF не удалось очистить из хранилища." : "Программа и её шаги удалены.");
      setDeleteTarget(null);
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось удалить программу."); }
    finally { setBusy(false); }
  }

  return <div className="programs-panel">
    <form className="admin-panel program-builder" onSubmit={(event) => { event.preventDefault(); if (canPublish && !busy) { if (preview) void publish(); else setPreview(true); } }}>
      <div className="panel-title"><div><p className="eyebrow">Последовательное обучение</p><h2>Новая программа</h2></div><span className="program-rule">{preview ? "2 / 2 · Проверка" : "1 / 2 · Содержание"}</span></div>
      {preview ? <div className="program-preview">
        <h3 ref={reviewTitle} tabIndex={-1}>Проверьте программу перед публикацией</h3>
        <p><strong>{title.trim()}</strong><br />Шагов: {draftTasks.length} · На каждый шаг: {deadlineHours} ч</p>
        {draftTasks.length === 1 && <p className="program-review-note">Сейчас в программе только один шаг. Если планировали несколько, вернитесь к редактированию и добавьте остальные.</p>}
        <ol>{draftTasks.map((task) => <li key={task.id}><strong>{task.title.trim()}</strong><span>До {formatMiles(task.maxPoints)}{task.resourceUrl.trim() ? " · С материалом" : ""}</span><p>{task.description.trim()}</p></li>)}</ol>
        <div className="program-builder-actions"><button type="button" className="button button-edit" disabled={busy} onClick={() => setPreview(false)}>← К редактированию</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Публикуем..." : "Подтвердить и опубликовать"}</button></div>
      </div> : <>
        <fieldset disabled={busy} className="program-fields">
          <div className="form-two-columns">
            <label>Название программы<input required minLength={2} maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, Старт новичка" /></label>
            <label>Срок на каждый шаг, часов<input required type="number" min="1" max="720" step="1" value={deadlineHours} onChange={(event) => setDeadlineHours(event.target.value)} /></label>
          </div>
          <div className="program-steps-heading"><div><p className="eyebrow">Содержание</p><h3>Шаги программы</h3></div><span>{draftTasks.length} / 100</span></div>
          {draftTasks.length === 0 ? <div className="program-empty-steps"><span aria-hidden="true">＋</span><div><strong>Начните с первого шага</strong><p>Добавьте задания в нужном порядке. Участники будут проходить их последовательно.</p></div></div> :
            <div className="program-step-editor">{draftTasks.map((task, index) => <div className="program-step" key={task.id}>
              <div className="program-step-head"><div><span>Этап {String(index + 1).padStart(2, "0")}</span><strong>Шаг {index + 1}</strong></div><button type="button" className="button button-danger button-small" aria-label={`Удалить шаг ${index + 1}`} onClick={() => setDraftTasks((current) => current.filter((item) => item.id !== task.id))}>Удалить</button></div>
              <label>Название шага<input ref={index === draftTasks.length - 1 ? newStepInput : undefined} required minLength={2} maxLength={160} value={task.title} onChange={(event) => updateTask(task.id, "title", event.target.value)} placeholder="Например, Познакомиться с командой" /></label>
              <label>Описание<textarea required minLength={2} maxLength={5000} rows={3} value={task.description} onChange={(event) => updateTask(task.id, "description", event.target.value)} placeholder="Что нужно сделать и какой ответ отправить" /></label>
              <div className="form-two-columns">
                <label>Максимум миль<input required type="number" min="0" max="100" step="1" value={task.maxPoints} onChange={(event) => updateTask(task.id, "maxPoints", event.target.value)} /></label>
                <label>Ссылка на материал <span className="field-hint">необязательно</span><input type="url" maxLength={2000} value={task.resourceUrl} aria-invalid={!validLink(task.resourceUrl)} onChange={(event) => updateTask(task.id, "resourceUrl", event.target.value)} placeholder="https://youtube.com/..." />{!validLink(task.resourceUrl) && <span className="program-field-error">Укажите ссылку с http:// или https://</span>}</label>
              </div>
              <ResourceCard url={task.resourceUrl} caption="Так участник увидит материал" />
              <label>PDF-файлы <span className="field-hint">необязательно · до 15 МБ каждый</span><input type="file" accept="application/pdf,.pdf" multiple onChange={(event) => {
                const selected = [...(event.target.files || [])];
                const valid = selected.filter((file) => (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) && file.size <= 15 * 1024 * 1024);
                if (valid.length !== selected.length) onError("Прикрепляйте только PDF-файлы размером не больше 15 МБ.");
                if (task.files.length + valid.length > 10) { onError("К шагу можно прикрепить не больше 10 PDF."); event.target.value = ""; return; }
                updateTask(task.id, "files", [...task.files, ...valid]); event.target.value = "";
              }} /></label>
              {task.files.length > 0 && <ul className={styles.selectedFiles}>{task.files.map((file, fileIndex) => <li key={`${file.name}-${file.lastModified}-${fileIndex}`}><span>{file.name} · {(file.size / 1048576).toFixed(1)} МБ</span><button type="button" onClick={() => updateTask(task.id, "files", task.files.filter((_, itemIndex) => itemIndex !== fileIndex))}>Убрать</button></li>)}</ul>}
            </div>)}</div>}
          <button type="button" className="program-add-step" disabled={draftTasks.length >= 100} onClick={addStep}>＋ {draftTasks.length ? "Добавить следующий шаг" : "Добавить первый шаг"}</button>
        </fieldset>
        <div className="program-builder-actions"><p className="program-publish-hint">{canPublish ? "Все шаги заполнены. Проверьте их перед публикацией." : "Заполните название, срок и каждый добавленный шаг."}</p><button type="submit" className="button button-primary" disabled={busy || !canPublish}>Далее: проверить программу →</button></div>
      </>}
    </form>
    <ReadyProgramsPanel programs={programs} tasks={tasks} actorId={actorId} canManageAll={canManageAll} onChange={onChange} onError={onError} />
    <div className="admin-panel table-panel">
      <div className="panel-title"><div><p className="eyebrow">Опубликованные</p><h2>Программы команды</h2></div></div>
      {programs.length === 0 ? <div className="empty-admin"><p>Программ пока нет.</p></div> : programs.map((program) => {
        const canManage = canManageAll || program.publisherId === actorId;
        return <div className="program-row" key={program.id}>
          <div className="program-row-copy"><strong>{program.title}</strong><span>{tasks.filter((task) => task.programId === program.id).length} шагов · {program.templateKey ? "Без дедлайна" : `${program.deadlineHours} ч на шаг`}</span></div>
          <span className={"admin-status " + (program.isActive ? "active" : "inactive")}>{program.isActive ? "Активна" : "Скрыта"}</span>
          {canManage && <div className="row-actions"><button className={"button " + (program.isActive ? "button-warning" : "button-success")} onClick={() => void toggle(program)} disabled={busy}>{program.isActive ? "Скрыть" : "Активировать"}</button><button className="button button-danger" onClick={() => setDeleteTarget(program)} disabled={busy}>Удалить</button></div>}
        </div>;
      })}
    </div>
    {deleteTarget && <ConfirmModal title="Удалить программу?" description={<>«{deleteTarget.title}», все её шаги и отправленные работы будут удалены без возможности восстановления.</>} confirmLabel="Удалить программу" busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={() => void remove()} />}
  </div>;
}
