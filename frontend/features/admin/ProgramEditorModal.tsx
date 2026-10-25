"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import type { QuizQuestion } from "@/shared/domain/task-quiz";
import { PROGRAM_GAMES, programGame } from "@/shared/domain/program-games";
import type { ProgramGameKey, Task, TaskProgram } from "@/shared/domain/types";
import { publishProgram } from "./program-publish";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { Drawer } from "@/frontend/shared/Drawer";
import { formatMiles } from "@/frontend/shared/lib/format";
import { LevelPicker } from "./LevelPicker";
import { ActionsMenu, type MenuItem } from "./AdminTasksView";
import { actionIcons } from "./AdminIcons";
import { EditorWithPreview } from "./EditorWithPreview";
import { TaskEditorFields } from "./TaskEditorFields";
import { TaskPreview } from "./TaskPreview";
import { STEP_DEADLINE_PRESETS, deadlineLabel, editorProblems, freshQuestions, type EditorProblem, type EditorValue } from "./task-editor";
import { clearDraft, programDraftKey, readDraft, savedAtText, writeDraft } from "./editor-drafts";
import styles from "./ProgramEditorModal.module.css";

type StepValue = Pick<EditorValue, "title" | "description" | "resourceUrl" | "maxPoints" | "voiceAnswer">;
/** One step of the new program: a normal task, or a ready game (`game`). */
type DraftStep = { id: number; game?: ProgramGameKey; value: StepValue; files: File[]; video: File | null; questions: QuizQuestion[]; missingFiles?: string[] };
type SavedProgram = { title: string; deadlineHours: string; level: number; steps: Array<Omit<DraftStep, "files" | "video">>; savedAt: string };
type View = { kind: "list" } | { kind: "step"; id: number } | { kind: "review" };

const emptyValue: StepValue = { title: "", description: "", resourceUrl: "", maxPoints: "10", voiceAnswer: false };
const problemWords: Record<EditorProblem["field"], string> = { title: "название", description: "описание", miles: "мили", link: "ссылку", quiz: "вопросы" };
const stepProblems = (step: DraftStep) => step.game ? [] : editorProblems(step.value, step.questions);
const isBlank = (step: DraftStep) => !step.game && !step.value.title.trim() && !step.value.description.trim() && !step.value.resourceUrl.trim() && !step.files.length && !step.video && !step.questions.length;
const validHours = (value: string) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 720;

// Building a new program: its name, level and time per step on top, then a short list of steps. A step opens in
// the same editor as a separate task. Everything typed is kept in this browser until the program is published.
export function ProgramEditorModal({ userId, onCreated, onClose, onError }: { userId: string; onCreated: (program: TaskProgram, tasks: Task[]) => void; onClose: () => void; onError: (message: string) => void }) {
  const [restored] = useState(() => readDraft<SavedProgram>(programDraftKey(userId)));
  const [title, setTitle] = useState(restored?.title || "");
  const [deadlineHours, setDeadlineHours] = useState(restored?.deadlineHours || "72");
  const [customDeadline, setCustomDeadline] = useState(() => !STEP_DEADLINE_PRESETS.some(([hours]) => String(hours) === (restored?.deadlineHours || "72")));
  const [level, setLevel] = useState(restored?.level || 1);
  const [steps, setSteps] = useState<DraftStep[]>(() => (restored?.steps || []).map((step) => ({ ...step, files: [], video: null })));
  const [view, setView] = useState<View>({ kind: "list" });
  const [notice, setNotice] = useState(Boolean(restored));
  const [gamesOpen, setGamesOpen] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [dragged, setDragged] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const nextId = useRef(Math.max(0, ...(restored?.steps || []).map((step) => step.id + 1)));
  const listTop = useRef<HTMLDivElement>(null);

  const hours = Number(deadlineHours);
  const programProblems = [
    ...(title.trim().length < 2 ? ["название программы"] : []),
    ...(!validHours(deadlineHours) ? ["срок на шаг (от 1 до 720 часов)"] : []),
    ...(!steps.length ? ["хотя бы один шаг"] : steps.every((step) => step.game) ? ["хотя бы одно обычное задание"] : []),
  ];
  const brokenSteps = steps.map((step, index) => ({ index, problems: stepProblems(step) })).filter((item) => item.problems.length);
  const ready = !programProblems.length && !brokenSteps.length;

  // Keep the draft: on every change, a moment later.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!title.trim() && !steps.length) { clearDraft(programDraftKey(userId)); return; }
      writeDraft(programDraftKey(userId), {
        title, deadlineHours, level, savedAt: new Date().toISOString(),
        steps: steps.map(({ files, video, ...step }) => ({ ...step, missingFiles: [...new Set([...(step.missingFiles || []), ...files.map((file) => file.name), ...(video ? [video.name] : [])])] })),
      } satisfies SavedProgram);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [userId, title, deadlineHours, level, steps]);

  useEffect(() => { listTop.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "instant" }); }, [view.kind]);

  const update = (id: number, patch: Partial<DraftStep>) => setSteps((current) => current.map((step) => step.id === id ? { ...step, ...patch } : step));
  const updateValue = (id: number, patch: Partial<StepValue>) => setSteps((current) => current.map((step) => step.id === id ? { ...step, value: { ...step.value, ...patch } } : step));
  function addStep() {
    const step: DraftStep = { id: nextId.current++, value: { ...emptyValue }, files: [], video: null, questions: [] };
    setSteps((current) => [...current, step]);
    setView({ kind: "step", id: step.id });
  }
  function addGame(kind: ProgramGameKey) {
    const game = programGame(kind);
    if (!game) return;
    setSteps((current) => [...current, { id: nextId.current++, game: kind, value: { ...emptyValue, title: game.title, description: game.description, maxPoints: String(game.reward) }, files: [], video: null, questions: [] }]);
    setGamesOpen(false);
  }
  function copyStep(step: DraftStep) {
    const copy: DraftStep = { ...step, id: nextId.current++, value: { ...step.value, title: `${step.value.title} (копия)`.slice(0, 160) }, files: [...step.files], questions: freshQuestions(step.questions) };
    setSteps((current) => { const index = current.findIndex((item) => item.id === step.id); return [...current.slice(0, index + 1), copy, ...current.slice(index + 1)]; });
  }
  function move(id: number, to: number) {
    setSteps((current) => {
      const from = current.findIndex((step) => step.id === id);
      if (from < 0 || to < 0 || to >= current.length || from === to) return current;
      const next = [...current];
      const [step] = next.splice(from, 1);
      next.splice(to, 0, step);
      return next;
    });
  }
  /** Back to the list; a new step left completely empty is dropped. */
  function closeStep() {
    setSteps((current) => current.filter((step) => !(view.kind === "step" && step.id === view.id && isBlank(step))));
    setView({ kind: "list" });
  }
  function startOver() {
    clearDraft(programDraftKey(userId));
    setTitle(""); setDeadlineHours("72"); setCustomDeadline(false); setLevel(1); setSteps([]); setNotice(false); setTried(false);
  }
  function review() {
    if (!ready) { setTried(true); return; }
    setView({ kind: "review" });
  }

  async function publish() {
    if (busy || !ready) return;
    setBusy(true);
    try {
      const { program, tasks, failed } = await publishProgram({
        title: title.trim(), deadlineHours: hours, level,
        steps: steps.map((step) => ({ game: step.game, title: step.value.title.trim(), description: step.value.description.trim(), resourceUrl: step.value.resourceUrl.trim(), maxPoints: Number(step.value.maxPoints), voiceAnswer: step.value.voiceAnswer, files: step.files, video: step.video, questions: step.questions })),
      }, setProgress);
      clearDraft(programDraftKey(userId));
      onCreated(program, tasks);
      onClose();
      const hasVideo = steps.some((step) => step.video);
      onError(failed.length ? `Программа опубликована, но не сохранились: ${failed.join(", ")}. Их можно добавить позже через «Изменить» у шага.`
        : `Программа опубликована. Первый шаг уже доступен участникам.${hasVideo ? " Видео сжимаются и появятся через несколько минут." : ""}`);
    } catch (error) { onError(error instanceof Error ? error.message : "Не удалось создать программу."); }
    finally { setBusy(false); setProgress(""); }
  }

  function onDrop(event: DragEvent, index: number) {
    event.preventDefault();
    if (dragged !== null) move(dragged, index);
    setDragged(null); setDropTarget(null);
  }

  const current = view.kind === "step" ? steps.find((step) => step.id === view.id) : undefined;
  const currentIndex = current ? steps.indexOf(current) : -1;
  const summary = view.kind === "review" ? `${steps.length} ${steps.length === 1 ? "шаг" : steps.length < 5 ? "шага" : "шагов"} · ${validHours(deadlineHours) ? deadlineLabel(hours) : "?"} на шаг · уровень ${level}`
    : tried && !ready ? `Нужно заполнить: ${[...programProblems, ...brokenSteps.map((item) => `шаг ${item.index + 1} — ${[...new Set(item.problems.map((problem) => problemWords[problem.field]))].join(", ")}`)].join("; ")}`
      : `${steps.length ? `${steps.length} ${steps.length === 1 ? "шаг" : steps.length < 5 ? "шага" : "шагов"}` : "Шагов пока нет"} · черновик сохраняется автоматически`;

  const footer = view.kind === "step" && current ? <>
    <span className="form-sheet-summary">Шаг {currentIndex + 1} из {steps.length}</span>
    <button type="button" className="button button-outline-danger" disabled={busy} onClick={() => { setSteps((list) => list.filter((step) => step.id !== current.id)); setView({ kind: "list" }); }}>Удалить шаг</button>
    <button type="button" className="button button-primary" disabled={busy} onClick={closeStep}>Готово</button>
  </> : view.kind === "review" ? <>
    <span className="form-sheet-summary">{summary}</span>
    <button type="button" className="button button-muted" disabled={busy} onClick={() => setView({ kind: "list" })}>← Изменить</button>
    <button type="button" className="button button-primary" disabled={busy} onClick={() => void publish()}>{busy ? progress || "Публикуем…" : "Опубликовать"}</button>
  </> : <>
    <span className="form-sheet-summary">{summary}</span>
    <button type="button" className="button button-muted" disabled={busy} onClick={onClose}>Закрыть</button>
    <button type="button" className="button button-primary" disabled={busy} onClick={review}>Проверить и опубликовать →</button>
  </>;

  return <ModalSheet title={view.kind === "step" ? `Программа · шаг ${currentIndex + 1}` : view.kind === "review" ? "Проверка перед публикацией" : "Новая программа"} tall wide footer={footer} onClose={() => { if (!busy) onClose(); }}>
    <div ref={listTop} className={`form-sheet ${styles.builder}`}>
      {view.kind === "step" && current ? <>
        <button type="button" className={styles.backLink} onClick={closeStep}>← Ко всем шагам</button>
        {Boolean(current.missingFiles?.length) && <p className={styles.notice}>Файлы не сохраняются в черновике — выберите их заново: {current.missingFiles!.join(", ")}. <button type="button" onClick={() => update(current.id, { missingFiles: [] })}>Понятно</button></p>}
        <EditorWithPreview
          editor={<TaskEditorFields key={current.id} mode="step" stepDeadlineHours={validHours(deadlineHours) ? hours : undefined} disabled={busy}
            value={{ ...current.value, level, hasDeadline: false, deadline: "" }} problems={stepProblems(current)} showProblems={tried} onError={onError}
            onChange={(key, value) => { if (key in emptyValue) updateValue(current.id, { [key]: value } as Partial<StepValue>); }}
            materials={{ attachments: [], files: current.files, onFilesChange: (files) => update(current.id, { files }), onRemoveAttachment: () => undefined,
              video: { file: current.video, removing: false, onFile: (video) => update(current.id, { video }), onRemove: () => undefined } }}
            quiz={{ questions: current.questions, loading: false, onChange: (questions) => update(current.id, { questions }) }} />}
          preview={<TaskPreview mode="step" stepDeadlineHours={validHours(deadlineHours) ? hours : undefined} value={{ ...current.value, level, hasDeadline: false, deadline: "" }}
            video={current.video?.name || null} pdfs={current.files.map((file) => ({ name: file.name, size: file.size }))} questions={current.questions} />} />
      </> : view.kind === "review" ? <div className={styles.review}>
        <div className={styles.reviewHead}><h3>{title.trim()}</h3><p>Уровень {level} · {deadlineLabel(hours)} на каждый шаг · шагов: {steps.length}</p></div>
        {steps.length === 1 && <p className={styles.notice}>В программе только один шаг. Если планировали несколько — вернитесь и добавьте остальные.</p>}
        <ol className={styles.reviewList}>{steps.map((step) => <li key={step.id}>
          <strong>{step.value.title.trim()}</strong>
          <span className={styles.meta}><StepBadges step={step} /></span>
          {!step.game && <p>{step.value.description.trim()}</p>}
        </li>)}</ol>
        <p className={styles.reviewNote}>После публикации первый шаг сразу откроется участникам уровня {level}. Шаги можно будет менять, добавлять и переставлять.</p>
      </div> : <>
        {notice && <p className={styles.notice}>Восстановлен черновик ({restored ? savedAtText(restored.savedAt) : ""}). Файлы и видео в черновике не хранятся — их нужно выбрать заново. <button type="button" onClick={startOver}>Начать с чистого листа</button> <button type="button" onClick={() => setNotice(false)}>Понятно</button></p>}
        <section className={styles.card} aria-label="Программа">
          <label>Название программы
            <input value={title} maxLength={160} disabled={busy} aria-invalid={tried && title.trim().length < 2} onChange={(event) => setTitle(event.target.value)} placeholder="Например, Старт новичка" />
          </label>
          <LevelPicker value={level} disabled={busy} onChange={setLevel} />
          <div className={styles.deadline} role="group" aria-label="Срок на каждый шаг">
            <span className={styles.label}>Срок на каждый шаг <small>после открытия шага</small></span>
            <div className={styles.chips}>
              {STEP_DEADLINE_PRESETS.map(([value, label]) => <button key={value} type="button" aria-pressed={!customDeadline && deadlineHours === String(value)} disabled={busy}
                className={!customDeadline && deadlineHours === String(value) ? styles.chipOn : ""} onClick={() => { setCustomDeadline(false); setDeadlineHours(String(value)); }}>{label}</button>)}
              <button type="button" aria-pressed={customDeadline} disabled={busy} className={customDeadline ? styles.chipOn : ""} onClick={() => setCustomDeadline(true)}>Своё</button>
            </div>
            {customDeadline && <label className={styles.hoursField}>Часов на шаг
              <input type="number" inputMode="numeric" min="1" max="720" step="1" value={deadlineHours} disabled={busy} aria-invalid={!validHours(deadlineHours)} onChange={(event) => setDeadlineHours(event.target.value)} />
              <small>{validHours(deadlineHours) ? `= ${deadlineLabel(hours)}` : "от 1 до 720 часов"}</small>
            </label>}
          </div>
        </section>

        <section className={styles.card} aria-label="Шаги программы">
          <div className={styles.stepsHead}><h3>Шаги</h3><span>{steps.length ? `${steps.length} · проходятся по порядку` : "участник проходит их по порядку"}</span></div>
          {steps.length === 0 ? <div className={styles.empty}><strong>Начните с первого шага</strong><p>Шаг — это задание: описание, материалы и, если нужно, вопросы. Можно добавить и готовую игру.</p></div>
            : <ol className={styles.steps}>{steps.map((step, index) => {
              const problems = stepProblems(step);
              const items: MenuItem[] = [
                ...(!step.game ? [{ label: "Изменить", icon: actionIcons.edit, onSelect: () => setView({ kind: "step", id: step.id }) },
                  { label: "Создать копию", icon: actionIcons.copy, onSelect: () => copyStep(step) }] : []),
                ...(index > 0 ? [{ label: "Выше", icon: actionIcons.up, onSelect: () => move(step.id, index - 1) }] : []),
                ...(index < steps.length - 1 ? [{ label: "Ниже", icon: actionIcons.down, onSelect: () => move(step.id, index + 1) }] : []),
                { label: "Удалить шаг", icon: actionIcons.remove, danger: true, onSelect: () => setSteps((list) => list.filter((item) => item.id !== step.id)) },
              ];
              return <li key={step.id} draggable={!busy} className={`${styles.step} ${dropTarget === index ? styles.dropTarget : ""} ${dragged === step.id ? styles.dragging : ""}`}
                onDragStart={(event) => { setDragged(step.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDragged(null); setDropTarget(null); }}
                onDragOver={(event) => { if (dragged === null) return; event.preventDefault(); setDropTarget(index); }} onDrop={(event) => onDrop(event, index)}>
                <span className={styles.handle} aria-hidden="true" title="Перетащите, чтобы поменять порядок">⋮⋮</span>
                <span className={styles.number}>{index + 1}</span>
                <button type="button" className={styles.stepMain} disabled={Boolean(step.game) || busy} onClick={() => setView({ kind: "step", id: step.id })} aria-label={step.game ? undefined : `Изменить шаг ${index + 1}`}>
                  <strong className={step.value.title.trim() ? "" : styles.untitled}>{step.value.title.trim() || "Без названия"}</strong>
                  <span className={styles.meta}><StepBadges step={step} /></span>
                  {problems.length > 0 && <span className={styles.problem}>⚠ Нужно заполнить: {[...new Set(problems.map((problem) => problemWords[problem.field]))].join(", ")}</span>}
                </button>
                <span className={styles.miles}>{formatMiles(Number(step.value.maxPoints) || 0)}</span>
                <ActionsMenu title={step.value.title || `Шаг ${index + 1}`} items={items} disabled={busy} />
              </li>;
            })}</ol>}
          <div className={styles.addRow}>
            <button type="button" className={styles.add} disabled={busy || steps.length >= 100} onClick={addStep}>＋ Шаг</button>
            <button type="button" className={styles.add} disabled={busy} aria-expanded={gamesOpen} onClick={() => setGamesOpen((open) => !open)}>🎮 Готовая игра</button>
          </div>
          <Drawer open={gamesOpen}><div className={styles.games}>
            {PROGRAM_GAMES.map((game) => {
              const added = steps.some((step) => step.game === game.kind);
              return <article key={game.kind} className={styles.game}>
                <span aria-hidden="true">{game.icon}</span>
                <div><strong>{game.title}</strong><p>{game.description}</p><small>{formatMiles(game.reward)} · без срока · около {game.minutes} минут</small></div>
                <button type="button" className="button button-primary" disabled={busy || added} onClick={() => addGame(game.kind)}>{added ? "Уже добавлена" : "Добавить"}</button>
              </article>;
            })}
          </div></Drawer>
        </section>
      </>}
    </div>
  </ModalSheet>;
}

function StepBadges({ step }: { step: DraftStep }) {
  if (step.game) return <span className={styles.badgeGame}>🎮 игра · без срока</span>;
  return <>
    {step.video && <span>🎬 видео</span>}
    {step.files.length > 0 && <span>📄 {step.files.length} PDF</span>}
    {step.value.resourceUrl.trim() && <span>🔗 ссылка</span>}
    {step.questions.length > 0 && <span>✅ вопросов: {step.questions.length}</span>}
    {step.value.voiceAnswer && <span>🎙️ голосовое</span>}
    {Boolean(step.missingFiles?.length) && <span className={styles.badgeWarn}>выбрать файлы заново</span>}
  </>;
}
