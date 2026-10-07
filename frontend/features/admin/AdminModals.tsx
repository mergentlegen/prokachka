"use client";
import type { FormEvent } from "react";
import type { Task, TaskAttachment, TaskProgram } from "@/shared/domain/types";
import { ResourceCard } from "@/frontend/shared/ResourceCard";
import { FormSheet } from "@/frontend/shared/FormSheet";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import { TaskFilePicker } from "./TaskFilePicker";
import { TaskVideoField } from "./TaskVideoField";
import { QuizEditor } from "./QuizEditor";
import type { QuizQuestion } from "@/shared/domain/task-quiz";
import { formatMiles } from "@/frontend/shared/lib/format";
import { MAX_MILES } from "@/shared/domain/miles";
export type TaskDraft = { title: string; description: string; resourceUrl: string; maxPoints: string; hasDeadline: boolean; deadline: string };
export type ReviewDraft = { points: string; comment: string };

export function TaskEditorModal({ taskId, task, program, draft, editing, busy, busyLabel, attachments, files, onFilesChange, onRemoveAttachment, video, quiz, onChange, onClose, onSubmit }: { taskId?: string; task?: Task; program?: TaskProgram; draft: TaskDraft; editing: boolean; busy: boolean; busyLabel?: string; attachments: TaskAttachment[]; files: File[]; onFilesChange: (files: File[]) => void; onRemoveAttachment: (attachment: TaskAttachment) => void;
  video: { file: File | null; removing: boolean; onFile: (file: File | null) => void; onRemove: (removing: boolean) => void; onError: (message: string) => void };
  quiz: { questions: QuizQuestion[]; loading: boolean; onChange: (questions: QuizQuestion[]) => void };
  onChange: (key: keyof TaskDraft, value: string | boolean) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  // A program step takes its time from the program, so it has no date of its own.
  const programStep = Boolean(program) || task?.publicationType === "sequential";
  return <FormSheet title={editing ? "Изменить задание" : program ? "Новый шаг программы" : "Новое задание"} busy={busy} busyLabel={busyLabel}
    submitLabel={editing ? "Сохранить" : program ? "Добавить шаг" : "Создать задание"} onClose={onClose} onSubmit={onSubmit}
    intro={program && !editing ? <>Шаг встанет последним в программе «{program.title}», на него будет {program.deadlineHours} ч, как и на остальные шаги. Порядок можно поменять стрелками ↑ ↓. Тем, кто уже прошёл программу, новый шаг тоже откроется.</> : undefined}>
    <label>Название задания<input value={draft.title} onChange={(event) => onChange("title", event.target.value)} placeholder="Например, записать короткое видео" autoFocus /></label>
    <label>Описание<textarea value={draft.description} onChange={(event) => onChange("description", event.target.value)} placeholder="Что нужно сделать участнику и как отправить ответ" rows={5} /></label>
    <label><span className="field-label">Ссылка на материал <span className="field-hint">необязательно</span></span><input type="url" value={draft.resourceUrl} onChange={(event) => onChange("resourceUrl", event.target.value)} placeholder="https://youtube.com/..." /></label>
    <ResourceCard url={draft.resourceUrl} caption="Так участник увидит материал" />
    <TaskVideoField task={task} file={video.file} removing={video.removing} disabled={busy} onFile={video.onFile} onRemove={video.onRemove} onError={video.onError} />
    <QuizEditor questions={quiz.questions} loading={quiz.loading} disabled={busy} onChange={quiz.onChange} />
    <TaskFilePicker taskId={taskId} attachments={attachments} files={files} disabled={busy} onFilesChange={onFilesChange} onRemove={onRemoveAttachment} />
    <label>Максимум миль<input type="number" inputMode="numeric" min="0" max={MAX_MILES} step="1" value={draft.maxPoints} onChange={(event) => onChange("maxPoints", event.target.value)} /></label>
    {!programStep && <><label className="toggle-row"><span><strong>Срок сдачи</strong><small>{draft.hasDeadline ? "Участники должны отправить ответ до даты ниже" : "Без срока — можно отправить в любое время"}</small></span>
      <input type="checkbox" role="switch" className="toggle-switch" checked={draft.hasDeadline} onChange={(event) => onChange("hasDeadline", event.target.checked)} /></label>
    {draft.hasDeadline && <label>Дата и время<input type="datetime-local" value={draft.deadline} onChange={(event) => onChange("deadline", event.target.value)} /></label>}</>}
  </FormSheet>;
}

export function ReviewModal({ draft, status, maxPoints, busy, onChange, onClose, onSubmit }: { draft: ReviewDraft; status: "accepted" | "revision"; maxPoints: number; busy: boolean; onChange: (key: keyof ReviewDraft, value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const accepting = status === "accepted";
  return <FormSheet title={accepting ? "Принять работу" : "Вернуть на доработку"} busy={busy} tone={accepting ? "success" : "warning"} submitLabel={accepting ? "Принять работу" : "Вернуть на доработку"} onClose={onClose} onSubmit={onSubmit}
    intro={accepting ? "Мили сразу попадут в рейтинг участника." : "Напишите понятный комментарий, чтобы участник знал, что исправить."}>
    <label><span className="field-label">Мили <span className="field-hint">максимум {formatMiles(maxPoints)}</span></span><input type="number" inputMode="numeric" min="0" max={maxPoints} step="1" value={draft.points} onChange={(event) => onChange("points", event.target.value)} /></label>
    <label>{accepting ? "Комментарий наставника" : "Что нужно доработать"}<textarea value={draft.comment} onChange={(event) => onChange("comment", event.target.value)} placeholder={accepting ? "Например, отличный разбор..." : "Например, подробнее раскрой второй пункт..."} rows={5} required={!accepting} maxLength={4000} /></label>
  </FormSheet>;
}

/** Mentor accepts work done outside Prokachka (e.g. an external test) for a participant who never pressed "send". */
export function CompletionModal({ task, memberName, draft, busy, onChange, onClose, onSubmit }: { task: Task; memberName: string; draft: ReviewDraft; busy: boolean; onChange: (key: keyof ReviewDraft, value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <FormSheet title={`Засчитать: ${memberName}`} busy={busy} tone="success" submitLabel="Засчитать выполнение" submitDisabled={!draft.comment.trim()} onClose={onClose} onSubmit={onSubmit}
    intro={<>Задание «{task.title}» будет отмечено выполненным, даже если участник не нажал «Отправить ответ». Мили попадут в рейтинг, а обратная связь придёт участнику в Telegram.</>}>
    <label><span className="field-label">Мили <span className="field-hint">максимум {formatMiles(task.maxPoints)}</span></span><input type="number" inputMode="numeric" min="0" max={task.maxPoints} step="1" value={draft.points} onChange={(event) => onChange("points", event.target.value)} required /></label>
    <label>Обратная связь участнику<textarea value={draft.comment} onChange={(event) => onChange("comment", event.target.value)} placeholder="Например, результат теста и что стоит подтянуть..." rows={5} required maxLength={4000} /></label>
  </FormSheet>;
}

export function DeleteModal({ task, busy, onClose, onConfirm }: { task: Task; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return <ConfirmModal title="Удалить задание?" eyebrow="Это нельзя отменить" confirmLabel="Удалить задание" busy={busy} onClose={onClose} onConfirm={onConfirm}
    description={<>«{task.title}» и все отправленные по нему ответы будут удалены у всех участников.</>} />;
}
