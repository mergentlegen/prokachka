"use client";
import type { FormEvent } from "react";
import type { Task, TaskAttachment } from "@/shared/domain/types";
import { ResourceCard } from "@/frontend/shared/ResourceCard";
import { TaskFilePicker } from "./TaskFilePicker";
import { formatMiles } from "@/frontend/shared/lib/format";
import { MAX_MILES } from "@/shared/domain/miles";
export type TaskDraft = { title: string; description: string; resourceUrl: string; maxPoints: string; hasDeadline: boolean; deadline: string };
export type ReviewDraft = { points: string; comment: string };

export function TaskEditorModal({ taskId, draft, editing, busy, attachments, files, onFilesChange, onRemoveAttachment, onChange, onClose, onSubmit }: { taskId?: string; draft: TaskDraft; editing: boolean; busy: boolean; attachments: TaskAttachment[]; files: File[]; onFilesChange: (files: File[]) => void; onRemoveAttachment: (attachment: TaskAttachment) => void; onChange: (key: keyof TaskDraft, value: string | boolean) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="editor-modal admin-form-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
    <p className="eyebrow">{editing ? "Редактирование" : "Новое задание"}</p>
    <h2>{editing ? "Изменить задание" : "Создать задание"}</h2>
    <label>Название задания<input value={draft.title} onChange={(event) => onChange("title", event.target.value)} placeholder="Например, записать короткое видео" autoFocus /></label>
    <label>Описание<textarea value={draft.description} onChange={(event) => onChange("description", event.target.value)} placeholder="Что нужно сделать участнику" rows={4} /></label>
    <label>Ссылка на материал <span className="field-hint">необязательно</span><input type="url" value={draft.resourceUrl} onChange={(event) => onChange("resourceUrl", event.target.value)} placeholder="https://youtube.com/..." /></label>
    <ResourceCard url={draft.resourceUrl} caption="Так участник увидит материал" />
    <TaskFilePicker taskId={taskId} attachments={attachments} files={files} disabled={busy} onFilesChange={onFilesChange} onRemove={onRemoveAttachment} />
    <div className="form-two-columns">
    <label>Максимум миль<input type="number" min="0" max={MAX_MILES} step="1" value={draft.maxPoints} onChange={(event) => onChange("maxPoints", event.target.value)} /></label>
      <label className="deadline-toggle"><span>Дедлайн</span><span className="switch-line"><input type="checkbox" checked={draft.hasDeadline} onChange={(event) => onChange("hasDeadline", event.target.checked)} /><span>{draft.hasDeadline ? "Установлен" : "Без дедлайна"}</span></span></label>
    </div>
    {draft.hasDeadline && <label>Дата и время дедлайна<input type="datetime-local" value={draft.deadline} onChange={(event) => onChange("deadline", event.target.value)} /></label>}
    <div className="modal-actions"><button type="button" className="button button-muted" onClick={onClose}>Отмена</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Сохраняем..." : editing ? "Сохранить изменения" : "Создать задание"}</button></div>
  </form></div>;
}

export function ReviewModal({ draft, status, maxPoints, busy, onChange, onClose, onSubmit }: { draft: ReviewDraft; status: "accepted" | "revision"; maxPoints: number; busy: boolean; onChange: (key: keyof ReviewDraft, value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const accepting = status === "accepted";
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="editor-modal admin-form-modal review-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
    <p className={"eyebrow " + (accepting ? "eyebrow-success" : "eyebrow-warning")}>{accepting ? "Финальная проверка" : "Нужна доработка"}</p>
    <h2>{accepting ? "Принять работу?" : "Вернуть на доработку?"}</h2>
    <p className="modal-description">{accepting ? "Укажи результат проверки. Мили автоматически попадут в рейтинг участника." : "Напиши понятный комментарий, чтобы участник знал, что исправить."}</p>
    <label>Мили <span className="field-hint">максимум {formatMiles(maxPoints)}</span><input type="number" min="0" max={maxPoints} step="1" value={draft.points} onChange={(event) => onChange("points", event.target.value)} /></label>
<label>{accepting ? "Комментарий наставника" : "Что нужно доработать"}<textarea value={draft.comment} onChange={(event) => onChange("comment", event.target.value)} placeholder={accepting ? "Например, отличный разбор..." : "Например, подробнее раскрой второй пункт..."} rows={5} required={!accepting} maxLength={4000} /></label>
    <div className="modal-actions"><button type="button" className="button button-muted" onClick={onClose}>Отмена</button><button type="submit" className={"button " + (accepting ? "button-success" : "button-warning")} disabled={busy}>{busy ? "Сохраняем..." : accepting ? "Принять работу" : "Вернуть на доработку"}</button></div>
  </form></div>;
}

/** Mentor accepts work done outside Prokachka (e.g. an external test) for a participant who never pressed "send". */
export function CompletionModal({ task, memberName, draft, busy, onChange, onClose, onSubmit }: { task: Task; memberName: string; draft: ReviewDraft; busy: boolean; onChange: (key: keyof ReviewDraft, value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="editor-modal admin-form-modal review-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
    <p className="eyebrow eyebrow-success">Засчитать за участника</p>
    <h2>{memberName}</h2>
    <p className="modal-description">Задание «{task.title}» будет отмечено выполненным, даже если участник не нажал «Отправить ответ». Мили попадут в рейтинг, а обратная связь придёт участнику в Telegram.</p>
    <label>Мили <span className="field-hint">максимум {formatMiles(task.maxPoints)}</span><input type="number" min="0" max={task.maxPoints} step="1" value={draft.points} onChange={(event) => onChange("points", event.target.value)} required /></label>
    <label>Обратная связь участнику<textarea value={draft.comment} onChange={(event) => onChange("comment", event.target.value)} placeholder="Например, результат теста и что стоит подтянуть..." rows={5} required maxLength={4000} /></label>
    <div className="modal-actions"><button type="button" className="button button-muted" onClick={onClose}>Отмена</button><button type="submit" className="button button-success" disabled={busy || !draft.comment.trim()}>{busy ? "Сохраняем..." : "Засчитать выполнение"}</button></div>
  </form></div>;
}

export function DeleteModal({ task, busy, onClose, onConfirm }: { task: Task; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="editor-modal admin-form-modal danger-modal" onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
    <p className="eyebrow eyebrow-danger">Опасное действие</p>
    <h2>Удалить задание?</h2>
    <p className="modal-description">«{task.title}» и вся история его отправок будут удалены. Это действие нельзя отменить.</p>
    <div className="modal-actions"><button type="button" className="button button-muted" onClick={onClose}>Отмена</button><button type="button" className="button button-danger" onClick={onConfirm} disabled={busy}>{busy ? "Удаляем..." : "Удалить задание"}</button></div>
  </div></div>;
}
