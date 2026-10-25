"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Task, TaskAttachment } from "@/shared/domain/types";
import type { QuizQuestion } from "@/shared/domain/task-quiz";
import { MAX_MILES } from "@/shared/domain/miles";
import { ResourceCard } from "@/frontend/shared/ResourceCard";
import { LevelPicker } from "./LevelPicker";
import { QuizEditor } from "./QuizEditor";
import { TaskVideoField, taskVideoProblem } from "./TaskVideoField";
import { MAX_TASK_PDFS, PdfFileList, addPdfFiles } from "./TaskFilePicker";
import { MILES_PRESETS, deadlineLabel, type EditorField, type EditorProblem, type EditorValue } from "./task-editor";
import styles from "./TaskEditorFields.module.css";

export type EditorMaterials = {
  taskId?: string; task?: Task;
  attachments: TaskAttachment[]; files: File[];
  onFilesChange: (files: File[]) => void; onRemoveAttachment: (attachment: TaskAttachment) => void;
  video: { file: File | null; removing: boolean; onFile: (file: File | null) => void; onRemove: (removing: boolean) => void };
};
export type EditorQuiz = { questions: QuizQuestion[]; loading: boolean; onChange: (questions: QuizQuestion[]) => void };

type Props = {
  /** `task` — a separate task with its own level and deadline; `step` — a program step, its time comes from the program. */
  mode: "task" | "step";
  value: EditorValue;
  onChange: <K extends keyof EditorValue>(key: K, value: EditorValue[K]) => void;
  materials: EditorMaterials;
  quiz: EditorQuiz;
  /** Hours for each step of the program (step mode). */
  stepDeadlineHours?: number;
  /** A ready game: no answer settings, the game itself is the answer. */
  interactive?: boolean;
  disabled: boolean;
  /** Problems are shown under their fields once the mentor has tried to save. */
  problems?: EditorProblem[];
  showProblems?: boolean;
  onError: (message: string) => void;
};

const icons = {
  video: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="m16 10.5 5-3v9l-5-3z" /></svg>,
  pdf: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>,
  link: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></svg>,
};

function SectionHead({ number, title, note }: { number: number; title: string; note?: ReactNode }) {
  return <div className={styles.sectionHead}><span className={styles.number} aria-hidden="true">{number}</span><div><h3>{title}</h3>{note && <p>{note}</p>}</div></div>;
}

/** A material button that opens the file dialog; a file can also be dropped on it. */
function FileTile({ accept, multiple, icon, title, hint, disabled, onFiles }: { accept: string; multiple: boolean; icon: ReactNode; title: string; hint: string; disabled: boolean; onFiles: (files: FileList) => void }) {
  const [over, setOver] = useState(false);
  return <label className={`drop-zone ${styles.tile} ${over ? styles.tileOver : ""} ${disabled ? styles.tileOff : ""}`}
    onDragOver={(event) => { if (disabled) return; event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
    onDrop={(event) => { event.preventDefault(); setOver(false); if (!disabled && event.dataTransfer.files.length) onFiles(event.dataTransfer.files); }}>
    <input type="file" accept={accept} multiple={multiple} disabled={disabled}
      style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", border: 0, opacity: 0 }}
      onChange={(event) => { if (event.currentTarget.files?.length) onFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <span className={styles.tileIcon}>{icon}</span>
    <span className={styles.tileText}><b>{title}</b><small>{hint}</small></span>
  </label>;
}

/** Two or more options in one row, like a switch with words. */
function Choice<T extends string>({ label, value, options, disabled, onChange }: { label: string; value: T; options: ReadonlyArray<readonly [T, string, string?]>; disabled: boolean; onChange: (value: T) => void }) {
  const id = useId();
  return <div className={styles.choice} role="radiogroup" aria-labelledby={id}>
    <span id={id} className={styles.choiceLabel}>{label}</span>
    <div className={styles.choiceOptions}>{options.map(([key, title, note]) => <button key={key} type="button" role="radio" aria-checked={value === key} disabled={disabled}
      className={value === key ? styles.choiceOn : ""} onClick={() => onChange(key)}><b>{title}</b>{note && <small>{note}</small>}</button>)}</div>
  </div>;
}

// The one task editor of the mentor panel: a separate task, a step of a running program and a step of a new program
// are filled in the same five blocks, in the order the participant sees them.
export function TaskEditorFields({ mode, value, onChange, materials, quiz, stepDeadlineHours, interactive = false, disabled, problems = [], showProblems = false, onError }: Props) {
  const [linkOpen, setLinkOpen] = useState(Boolean(value.resourceUrl));
  const [pdfWarning, setPdfWarning] = useState("");
  const [customMiles, setCustomMiles] = useState(() => !MILES_PRESETS.some((miles) => String(miles) === value.maxPoints));
  const linkInput = useRef<HTMLInputElement>(null);
  const focusLink = useRef(false);
  const problem = (field: EditorField) => showProblems ? problems.find((item) => item.field === field)?.message : undefined;
  const hasVideo = Boolean(materials.video.file || materials.task?.video);
  const pdfCount = materials.attachments.length + materials.files.length;
  const showLink = linkOpen || Boolean(value.resourceUrl);
  const withQuiz = quiz.questions.length > 0;

  useEffect(() => { if (showLink && focusLink.current) { linkInput.current?.focus(); focusLink.current = false; } }, [showLink]);

  function pickVideo(files: FileList) {
    const chosen = files[0];
    if (!chosen) return;
    const reason = taskVideoProblem(chosen);
    if (reason) { onError(reason); return; }
    materials.video.onFile(chosen); materials.video.onRemove(false);
  }
  function pickPdf(list: FileList) {
    const result = addPdfFiles(list, materials.attachments, materials.files);
    setPdfWarning(result.warning);
    if (result.files !== materials.files) materials.onFilesChange(result.files);
  }
  const error = (field: EditorField) => problem(field) && <span className={styles.error} role="alert">Нужно исправить: {problem(field)}</span>;

  return <div className={styles.fields}>
    <section className={styles.section} aria-label="Задание">
      <SectionHead number={1} title="Задание" />
      <label>Название
        <input value={value.title} disabled={disabled} maxLength={160} aria-invalid={Boolean(problem("title"))} onChange={(event) => onChange("title", event.target.value)} placeholder={mode === "step" ? "Например, познакомиться с командой" : "Например, записать короткое видео"} />
        {error("title")}
      </label>
      <label><span className="field-label">Описание <span className="field-hint">что сделать и как ответить</span></span>
        <textarea value={value.description} disabled={disabled} rows={5} maxLength={5000} aria-invalid={Boolean(problem("description"))} onChange={(event) => onChange("description", event.target.value)} placeholder="Например: посмотри видео и расскажи в голосовом, что из него возьмёшь в работу" />
        {error("description")}
      </label>
    </section>

    <section className={styles.section} aria-label="Материалы">
      <SectionHead number={2} title="Материалы" note="Участник увидит их сразу под описанием: видео, затем PDF, затем ссылку" />
      <div className={styles.tiles}>
        {!hasVideo && <FileTile accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm" multiple={false} icon={icons.video} title="Видео" hint="MP4, MOV, WebM · до 1 ГБ" disabled={disabled} onFiles={pickVideo} />}
        <FileTile accept="application/pdf,.pdf" multiple icon={icons.pdf} title={pdfCount ? "Ещё PDF" : "PDF"} hint={pdfCount >= MAX_TASK_PDFS ? "прикреплено 10 из 10" : `до 15 МБ · ${pdfCount} из ${MAX_TASK_PDFS}`} disabled={disabled || pdfCount >= MAX_TASK_PDFS} onFiles={pickPdf} />
        {!showLink && <button type="button" className={styles.tile} disabled={disabled} onClick={() => { focusLink.current = true; setLinkOpen(true); }}>
          <span className={styles.tileIcon}>{icons.link}</span><span className={styles.tileText}><b>Ссылка</b><small>YouTube, сайт, документ</small></span>
        </button>}
      </div>
      {hasVideo && <TaskVideoField bare task={materials.task} file={materials.video.file} removing={materials.video.removing} disabled={disabled} onFile={materials.video.onFile} onRemove={materials.video.onRemove} onError={onError} />}
      <PdfFileList taskId={materials.taskId} attachments={materials.attachments} files={materials.files} disabled={disabled} onFilesChange={materials.onFilesChange} onRemove={materials.onRemoveAttachment} />
      {pdfWarning && <p className={styles.warning} role="alert">{pdfWarning}</p>}
      {showLink && <div className={styles.link}>
        <label>Ссылка на материал
          <span className={styles.linkRow}>
            <input ref={linkInput} type="url" inputMode="url" maxLength={2000} value={value.resourceUrl} disabled={disabled} aria-invalid={Boolean(problem("link"))} onChange={(event) => onChange("resourceUrl", event.target.value)} placeholder="https://youtube.com/…" />
            <button type="button" className={styles.remove} disabled={disabled} aria-label="Убрать ссылку" onClick={() => { onChange("resourceUrl", ""); setLinkOpen(false); }}>×</button>
          </span>
          {error("link")}
        </label>
        <ResourceCard url={value.resourceUrl} caption="Так участник увидит материал" />
      </div>}
    </section>

    <section className={styles.section} aria-label="Проверка знаний">
      <SectionHead number={3} title="Проверка знаний" note={withQuiz ? "Участник ответит на вопросы прямо на сайте, после материалов. Ответы придут вам на проверку." : "Необязательно. Добавьте тест или открытый вопрос — участник ответит прямо на сайте."} />
      <QuizEditor bare questions={quiz.questions} loading={quiz.loading} disabled={disabled} onChange={quiz.onChange} />
      {error("quiz")}
    </section>

    {!interactive && <section className={styles.section} aria-label="Как участник отвечает">
      <SectionHead number={4} title="Как участник отвечает" />
      <Choice label="Ответ" value={value.voiceAnswer ? "voice" : "free"} disabled={disabled} onChange={(next) => onChange("voiceAnswer", next === "voice")}
        options={withQuiz
          ? [["free", "Только тест на сайте", "ответы на вопросы и есть работа"], ["voice", "Тест и голосовое", "после теста — голосовое в Telegram"]]
          : [["free", "Текст, фото, видео или файл", "через Telegram-бота"], ["voice", "Голосовое", "бот примет только голосовое"]]} />
    </section>}

    <section className={styles.section} aria-label="Настройки">
      <SectionHead number={interactive ? 4 : 5} title="Настройки" />
      {mode === "task" && <LevelPicker value={value.level} disabled={disabled} onChange={(level) => onChange("level", level)} />}
      <div className={styles.choice} role="group" aria-label="Награда в милях">
        <span className={styles.choiceLabel}>Награда</span>
        <div className={styles.choiceOptions}>
          {MILES_PRESETS.map((miles) => <button key={miles} type="button" aria-pressed={!customMiles && value.maxPoints === String(miles)} disabled={disabled}
            className={!customMiles && value.maxPoints === String(miles) ? styles.choiceOn : ""} onClick={() => { setCustomMiles(false); onChange("maxPoints", String(miles)); }}><b>{miles}</b><small>миль</small></button>)}
          <button type="button" aria-pressed={customMiles} disabled={disabled} className={customMiles ? styles.choiceOn : ""} onClick={() => setCustomMiles(true)}><b>Своё</b><small>число</small></button>
        </div>
        {customMiles && <label className={styles.inlineField}>Сколько миль
          <input type="number" inputMode="numeric" min="0" max={MAX_MILES} step="1" value={value.maxPoints} disabled={disabled} aria-invalid={Boolean(problem("miles"))} onChange={(event) => onChange("maxPoints", event.target.value)} />
        </label>}
        {error("miles")}
      </div>
      {mode === "task" ? <>
        <Choice label="Срок" value={value.hasDeadline ? "date" : "none"} disabled={disabled} onChange={(next) => onChange("hasDeadline", next === "date")}
          options={[["none", "Без срока", "можно в любое время"], ["date", "До даты", "задание с дедлайном"]]} />
        {value.hasDeadline && <label className={styles.inlineField}>Дата и время
          <input type="datetime-local" value={value.deadline} disabled={disabled} onChange={(event) => onChange("deadline", event.target.value)} />
        </label>}
      </> : <p className={styles.inherited}><b>Срок:</b> {stepDeadlineHours ? deadlineLabel(stepDeadlineHours) : "как у остальных шагов"} на шаг — он одинаковый для всей программы.</p>}
    </section>
  </div>;
}
