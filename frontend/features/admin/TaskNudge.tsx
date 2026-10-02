"use client";

import { useEffect, useState } from "react";
import { loadTaskNudge, sendTaskNudge, type TaskNudgeState } from "@/frontend/shared/api/admin-client";
import { plural } from "@/frontend/shared/lib/plural";
import styles from "./TaskNudge.module.css";

const timeFormat = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

/** "сегодня в 14:20" / "вчера в 23:30" / "3 октября в 09:05" */
export function nudgeMoment(iso: string, now = Date.now()) {
  const date = new Date(iso);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  const tomorrow = new Date(now + 86_400_000).toDateString() === date.toDateString();
  const yesterday = new Date(now - 86_400_000).toDateString() === date.toDateString();
  return `${sameDay ? "сегодня" : tomorrow ? "завтра" : yesterday ? "вчера" : dayFormat.format(date)} в ${timeFormat.format(date)}`;
}

/** What the block says: loading, nothing to do, waiting for the 12-hour pause, or ready to send. */
export function nudgeView(state: TaskNudgeState | null, now = Date.now()) {
  if (!state) return { kind: "loading" as const };
  if (state.nextAllowedAt && new Date(state.nextAllowedAt).getTime() > now) return { kind: "cooldown" as const, last: state.lastSentAt ? nudgeMoment(state.lastSentAt, now) : "", next: nudgeMoment(state.nextAllowedAt, now) };
  if (state.reachable === 0) return { kind: "nobody" as const };
  return { kind: "ready" as const };
}

// Lives inside the task results sheet: one tap to remind everyone who has not sent the task.
export function TaskNudge({ taskId, missing, onNotice }: { taskId: string; missing: number; onNotice?: (message: string) => void }) {
  const [state, setState] = useState<TaskNudgeState | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    loadTaskNudge(taskId).then((next) => { if (active) setState(next); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [taskId, missing]);

  async function send() {
    setSending(true);
    try {
      const next = await sendTaskNudge(taskId);
      setState(next); setConfirming(false);
      onNotice?.(`Напоминание отправится ${next.queued} ${plural(next.queued, "участнику", "участникам", "участникам")} в Telegram.`);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "Не удалось отправить напоминание.");
      setConfirming(false);
      loadTaskNudge(taskId).then(setState).catch(() => undefined);
    } finally { setSending(false); }
  }

  if (failed) return null;
  const view = nudgeView(state);
  const bell = <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></svg>;

  return <section className={`${styles.nudge} ${view.kind === "cooldown" ? styles.done : ""}`} aria-live="polite">
    <span className={styles.icon}>{bell}</span>
    <div className={styles.text}>
      {view.kind === "loading" && <><strong>Напомнить тем, кто не сдал</strong><small>Проверяем, у кого подключён Telegram…</small></>}
      {view.kind === "nobody" && <><strong>Напомнить некому</strong><small>У тех, кто не сдал, не подключён Telegram-бот. Напомните им лично.</small></>}
      {view.kind === "cooldown" && <><strong>Напомнили {view.last}</strong><small>Повторить можно {view.next}.</small></>}
      {view.kind === "ready" && state && !confirming && <><strong>Напомнить тем, кто не сдал</strong>
        <small>Сообщение в Telegram получат {state.reachable} {plural(state.reachable, "участник", "участника", "участников")}{state.unreachable > 0 ? ` · у ${state.unreachable} нет бота` : ""}</small></>}
      {view.kind === "ready" && state && confirming && <><strong>Отправить {state.reachable} {plural(state.reachable, "участнику", "участникам", "участникам")}?</strong>
        <small>Повторить можно будет через 12 часов.</small></>}
    </div>
    {view.kind === "ready" && !confirming && <button type="button" className="button button-primary" onClick={() => setConfirming(true)}>Напомнить</button>}
    {view.kind === "ready" && confirming && <div className={styles.actions}>
      <button type="button" className={`button ${styles.cancel}`} disabled={sending} onClick={() => setConfirming(false)}>Отмена</button>
      <button type="button" className="button button-primary" disabled={sending} onClick={() => void send()}>{sending ? "Отправляем…" : "Отправить"}</button>
    </div>}
  </section>;
}
