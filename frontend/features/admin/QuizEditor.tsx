"use client";

import { QUIZ_KIND_LABELS, QUIZ_LIMITS, type QuizKind, type QuizQuestion } from "@/shared/domain/task-quiz";
import styles from "./QuizEditor.module.css";

const newId = () => crypto.randomUUID();
export function newQuestion(kind: QuizKind): QuizQuestion {
  return kind === "text" ? { id: newId(), kind, prompt: "" } : { id: newId(), kind, prompt: "", options: ["", ""], correct: [] };
}

// The mentor's question builder: tests (one or several right answers) and open questions in any order.
export function QuizEditor({ questions, loading, disabled, onChange }: {
  questions: QuizQuestion[]; loading: boolean; disabled: boolean; onChange: (questions: QuizQuestion[]) => void;
}) {
  const update = (index: number, patch: Partial<QuizQuestion>) => onChange(questions.map((question, position) => position === index ? { ...question, ...patch } : question));
  const move = (index: number, step: number) => {
    const next = [...questions];
    const [item] = next.splice(index, 1);
    next.splice(index + step, 0, item);
    onChange(next);
  };
  function changeKind(index: number, kind: QuizKind) {
    const question = questions[index];
    if (kind === "text") return update(index, { kind, options: undefined, correct: undefined });
    const options = question.options?.length ? question.options : ["", ""];
    // A single-answer test keeps at most one marked option.
    const correct = kind === "single" ? (question.correct || []).slice(0, 1) : question.correct || [];
    update(index, { kind, options, correct });
  }
  function toggleCorrect(index: number, option: number) {
    const question = questions[index];
    const current = question.correct || [];
    const correct = question.kind === "single" ? [option] : current.includes(option) ? current.filter((value) => value !== option) : [...current, option].sort((a, b) => a - b);
    update(index, { correct });
  }
  function removeOption(index: number, option: number) {
    const question = questions[index];
    update(index, {
      options: (question.options || []).filter((_, position) => position !== option),
      correct: (question.correct || []).filter((value) => value !== option).map((value) => value > option ? value - 1 : value),
    });
  }

  return <div className={styles.editor}>
    <div className={styles.heading}>
      <strong>Вопросы на сайте <span className="field-hint">необязательно</span></strong>
      <small>{questions.length ? "Участник ответит прямо на сайте, после просмотра видео, и ответы придут вам на проверку." : "Добавьте тест или вопрос — тогда участник ответит на сайте, а не через Telegram."}</small>
    </div>
    {loading ? <p className={styles.muted}>Загружаем вопросы…</p> : <ol className={styles.list}>
      {questions.map((question, index) => <li key={question.id} className={styles.card}>
        <div className={styles.cardTop}>
          <span className={styles.number}>{index + 1}</span>
          <select value={question.kind} disabled={disabled} aria-label={`Тип вопроса ${index + 1}`} onChange={(event) => changeKind(index, event.target.value as QuizKind)}>
            {(Object.keys(QUIZ_KIND_LABELS) as QuizKind[]).map((kind) => <option key={kind} value={kind}>{QUIZ_KIND_LABELS[kind]}</option>)}
          </select>
          <div className={styles.tools}>
            <button type="button" disabled={disabled || index === 0} onClick={() => move(index, -1)} aria-label="Выше">↑</button>
            <button type="button" disabled={disabled || index === questions.length - 1} onClick={() => move(index, 1)} aria-label="Ниже">↓</button>
            <button type="button" className={styles.remove} disabled={disabled} onClick={() => onChange(questions.filter((_, position) => position !== index))} aria-label={`Удалить вопрос ${index + 1}`}>×</button>
          </div>
        </div>
        <textarea value={question.prompt} disabled={disabled} rows={2} maxLength={QUIZ_LIMITS.prompt} placeholder="Текст вопроса" aria-label={`Текст вопроса ${index + 1}`}
          onChange={(event) => update(index, { prompt: event.target.value })} />
        {question.kind !== "text" ? <div className={styles.options}>
          <small className={styles.muted}>{question.kind === "single" ? "Отметьте один верный вариант" : "Отметьте все верные варианты"}</small>
          {(question.options || []).map((option, position) => <div key={position} className={styles.option}>
            <label className={styles.mark} title="Верный ответ">
              <input type={question.kind === "single" ? "radio" : "checkbox"} name={`correct-${question.id}`} disabled={disabled}
                checked={(question.correct || []).includes(position)} onChange={() => toggleCorrect(index, position)} aria-label={`Вариант ${position + 1} верный`} />
            </label>
            <input value={option} disabled={disabled} maxLength={QUIZ_LIMITS.option} placeholder={`Вариант ${position + 1}`} aria-label={`Вариант ${position + 1}`}
              onChange={(event) => update(index, { options: (question.options || []).map((value, slot) => slot === position ? event.target.value : value) })} />
            {(question.options || []).length > 2 && <button type="button" className={styles.remove} disabled={disabled} onClick={() => removeOption(index, position)} aria-label={`Удалить вариант ${position + 1}`}>×</button>}
          </div>)}
          {(question.options || []).length < QUIZ_LIMITS.options && <button type="button" className={styles.addOption} disabled={disabled}
            onClick={() => update(index, { options: [...(question.options || []), ""] })}>+ Вариант</button>}
        </div> : <small className={styles.muted}>Участник напишет ответ своими словами — его оцените вы.</small>}
      </li>)}
    </ol>}
    {questions.length < QUIZ_LIMITS.questions && !loading && <div className={styles.add}>
      <button type="button" disabled={disabled} onClick={() => onChange([...questions, newQuestion("single")])}>+ Тест</button>
      <button type="button" disabled={disabled} onClick={() => onChange([...questions, newQuestion("text")])}>+ Открытый вопрос</button>
    </div>}
  </div>;
}
