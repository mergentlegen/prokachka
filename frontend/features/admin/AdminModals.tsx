"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import type { Task, TaskAttachment, TaskProgram } from "@/shared/domain/types";
import { FormSheet } from "@/frontend/shared/FormSheet";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import type { QuizQuestion } from "@/shared/domain/task-quiz";
import { formatMiles } from "@/frontend/shared/lib/format";
import { EditorWithPreview } from "./EditorWithPreview";
import { TaskEditorFields } from "./TaskEditorFields";
import { TaskPreview } from "./TaskPreview";
import { deadlineLabel, editorProblems, type EditorValue } from "./task-editor";
export type TaskDraft = EditorValue;
export type ReviewDraft = { points: string; comment: string };

const problemWords: Record<string, string> = { title: "название", description: "описание", miles: "мили", link: "ссылку", quiz: "вопросы" };

/** The words under the form: what will be published, or what is still missing. */
function editorSummary(draft: TaskDraft, step: boolean, stepDeadlineHours: number | undefined, missing: string[]) {
  if (missing.length) return `Нужно заполнить: ${missing.join(", ")}`;
  const miles = formatMiles(Number(draft.maxPoints) || 0);
  if (step) return `${miles} · ${stepDeadlineHours ? `${deadlineLabel(stepDeadlineHours)} на шаг` : "срок программы"}`;
  return `${miles} · ${draft.hasDeadline ? "с дедлайном" : "без срока"} · уровень ${draft.level}`;
}

export function TaskEditorModal({ taskId, task, program, programDeadlineHours, draft, editing, busy, busyLabel, attachments, files, onFilesChange, onRemoveAttachment, video, quiz, onChange, onClose, onSubmit, notice }: {
  taskId?: string; task?: Task; program?: TaskProgram;
  /** Hours for each step of the program the task belongs to (editing a step). */
  programDeadlineHours?: number;
  draft: TaskDraft; editing: boolean; busy: boolean; busyLabel?: string; attachments: TaskAttachment[]; files: File[]; onFilesChange: (files: File[]) => void; onRemoveAttachment: (attachment: TaskAttachment) => void;
  video: { file: File | null; removing: boolean; onFile: (file: File | null) => void; onRemove: (removing: boolean) => void; onError: (message: string) => void };
  quiz: { questions: QuizQuestion[]; loading: boolean; onChange: (questions: QuizQuestion[]) => void };
  onChange: <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** A line above the form: a restored draft, a copy, and so on. */
  notice?: ReactNode;
}) {
  const [tried, setTried] = useState(false);
  // A program step takes its time from the program, so it has no date of its own.
  const programStep = Boolean(program) || task?.publicationType === "sequential";
  const stepHours = program?.deadlineHours ?? programDeadlineHours;
  const problems = editorProblems(draft, quiz.questions);
  const missing = tried ? [...new Set(problems.map((item) => problemWords[item.field]))] : [];
  const videoLabel = video.file ? video.file.name : task?.video && !video.removing ? task.video.status === "ready" ? "Видео к заданию" : "Видео обрабатывается" : null;
  const intro = <>{program && !editing && <>Шаг встанет последним в программе «{program.title}». Порядок можно поменять стрелками ↑ ↓. Тем, кто уже прошёл программу, новый шаг тоже откроется.</>}{notice}</>;
  return <FormSheet wide title={editing ? "Изменить задание" : program ? "Новый шаг программы" : "Новое задание"} busy={busy} busyLabel={busyLabel}
    submitLabel={editing ? "Сохранить" : program ? "Добавить шаг" : "Создать задание"} onClose={onClose}
    summary={editorSummary(draft, programStep, stepHours, missing)}
    onSubmit={(event) => {
      if (problems.length) {
        setTried(true);
        // The first thing to fix comes into view: a field is focused, a message under a block is scrolled to.
        window.setTimeout(() => {
          const first = document.querySelector<HTMLElement>(".form-sheet [aria-invalid='true'], .form-sheet [role='alert']");
          first?.scrollIntoView({ block: "center", behavior: "smooth" });
          if (first?.matches("input, textarea")) first.focus({ preventScroll: true });
        }, 0);
        return;
      }
      onSubmit(event);
    }}
    intro={(program && !editing) || notice ? intro : undefined}>
    <EditorWithPreview
      editor={<TaskEditorFields mode={programStep ? "step" : "task"} value={draft} onChange={onChange} stepDeadlineHours={stepHours} interactive={Boolean(task?.interactiveKind)}
        disabled={busy} problems={problems} showProblems={tried} onError={video.onError}
        materials={{ taskId, task, attachments, files, onFilesChange, onRemoveAttachment, video }} quiz={quiz} />}
      preview={<TaskPreview value={draft} mode={programStep ? "step" : "task"} stepDeadlineHours={stepHours} interactive={Boolean(task?.interactiveKind)}
        video={videoLabel} pdfs={[...attachments.map((file) => ({ name: file.fileName, size: file.sizeBytes })), ...files.map((file) => ({ name: file.name, size: file.size }))]} questions={quiz.questions} />} />
  </FormSheet>;
}

export function ReviewModal({ draft, status, maxPoints, busy, onChange, onClose, onSubmit }: { draft: ReviewDraft; status: "accepted" | "revision"; maxPoints: number; busy: boolean; onChange: (key: keyof ReviewDraft, value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const accepting = status === "accepted";
  return <FormSheet title={accepting ? "Принять работу" : "Вернуть на доработку"} busy={busy} tone={accepting ? "success" : "warning"} submitLabel={accepting ? "Принять работу" : "Вернуть на доработку"} onClose={onClose} onSubmit={onSubmit}
    intro={accepting ? "Мили сразу добавятся к опыту (XP) участника." : "Напишите понятный комментарий, чтобы участник знал, что исправить."}>
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
