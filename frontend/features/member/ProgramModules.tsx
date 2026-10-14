"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ProgramModule, Submission, Task } from "@/shared/domain/types";
import { formatMiles } from "@/frontend/shared/lib/format";
import { orderedProgramModules, programStepStates } from "./member-progress";
import styles from "./ProgramModules.module.css";

type Props = {
  modules: ProgramModule[]; tasks: Task[]; latest: ReadonlyMap<string, Submission>;
  /** The open program; null when every block is closed. */
  selectedId: string | null; onSelect: (programId: string | null) => void;
  renderTask: (task: Task) => ReactNode; onFeedback: (taskId: string) => void;
};

function LockIcon() {
  return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><rect x="3" y="7" width="10" height="7" rx="2" fill="currentColor" /></svg>;
}

// Programs as modules: a block per program with its progress; a tap opens every step in order. Passed steps stay
// with their miles, the current one is the usual task card, the next ones show only their title until the previous step is accepted.
export function ProgramModules({ modules, tasks, latest, selectedId, onSelect, renderTask, onFeedback }: Props) {
  const [openStep, setOpenStep] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const ordered = orderedProgramModules(modules);
  const openId = ordered.some((module) => module.id === selectedId) ? selectedId : null;
  // Opening a block closes the one above it, so the page could jump past the new block: bring its title back into view.
  useEffect(() => {
    if (!opened.current) { opened.current = true; return; }
    const head = openId ? list.current?.querySelector<HTMLElement>(`[data-program="${openId}"]`) : null;
    if (head && head.getBoundingClientRect().top < 0) head.scrollIntoView({ block: "start" });
  }, [openId]);
  if (!ordered.length) return <div className="empty-state"><span>◌</span><p>Пока нет программ.</p></div>;
  return <div ref={list} className={styles.modules}>
    {ordered.map((module) => {
      const states = programStepStates(module, latest);
      const done = states.filter((state) => state === "done").length;
      const earned = module.steps.reduce((sum, step, index) => states[index] === "done" ? sum + (latest.get(step.id)?.points || 0) : sum, 0);
      const finished = module.status === "completed";
      const current = module.steps.find((_, index) => states[index] === "current");
      const waiting = current && latest.get(current.id)?.status === "pending";
      const open = module.id === openId;
      const summary = finished ? `Пройдена · ${formatMiles(earned)}`
        : current ? `Пройдено ${done} из ${module.steps.length} · ${waiting ? `шаг ${current.number} на проверке` : `сейчас шаг ${current.number}`}`
        : `Пройдено ${done} из ${module.steps.length}`;
      return <section key={module.id} className={`${styles.block} ${open ? styles.open : ""} ${finished ? styles.finished : ""}`}>
        <button type="button" className={styles.head} data-program={module.id} aria-expanded={open} onClick={() => { setOpenStep(null); onSelect(open ? null : module.id); }}>
          <span className={styles.count} aria-hidden="true">{finished ? "✓" : <>{done}<small>/{module.steps.length}</small></>}</span>
          <span className={styles.headText}>
            <strong>{module.title}</strong>
            <small>{summary}</small>
            {!finished && current && <em>{current.title}</em>}
          </span>
          <span className={styles.chevron} aria-hidden="true" />
          <i className={styles.bar} style={{ "--progress": `${Math.round((done / module.steps.length) * 100)}%` } as CSSProperties} />
        </button>
        {open && <ol className={styles.steps}>
          {module.steps.map((step, index) => {
            const state = states[index];
            const task = state === "current" ? tasks.find((item) => item.id === step.id) : undefined;
            if (task) return <li key={step.id} className={styles.currentCard}><p className={styles.currentLabel}>Шаг {step.number} · сейчас</p>{renderTask(task)}</li>;
            const submission = latest.get(step.id);
            const expanded = state === "done" && openStep === step.id;
            const note = state === "locked" ? " · закрыт" : state === "skipped" ? (module.status === "active" ? " · откроется после текущего" : " · не пройден") : "";
            return <li key={step.id} className={`${styles.step} ${styles[state]}`}>
              <button type="button" className={styles.row} disabled={state !== "done"} aria-expanded={state === "done" ? expanded : undefined} onClick={() => setOpenStep(expanded ? null : step.id)}>
                <span className={styles.mark} aria-hidden="true">{state === "done" ? "✓" : state === "locked" ? <LockIcon /> : step.number}</span>
                <span className={styles.text}><small>Шаг {step.number}{note}</small><strong>{step.title}</strong></span>
                <span className={styles.miles}>{state === "done" ? `+${formatMiles(submission?.points || 0)}` : formatMiles(step.maxPoints)}</span>
              </button>
              {expanded && <div className={styles.details}>
                {step.description ? <p className={styles.description}>{step.description}</p> : step.interactiveKind ? <p className={styles.description}>Игра пройдена.</p> : null}
                {step.resourceUrl && <a className={styles.link} href={step.resourceUrl} target="_blank" rel="noopener noreferrer">Открыть материал ↗</a>}
                {submission?.comment && <div className={styles.comment}><strong>Комментарий наставника</strong><p>{submission.comment}</p></div>}
                {!step.interactiveKind && <button type="button" className={styles.link} onClick={() => onFeedback(step.id)}>Открыть переписку с наставником →</button>}
              </div>}
            </li>;
          })}
        </ol>}
      </section>;
    })}
  </div>;
}
