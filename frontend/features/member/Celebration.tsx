"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Submission } from "@/shared/domain/types";
import { useCountUp } from "@/frontend/shared/hooks/use-count-up";
import { milesUnit } from "@/frontend/shared/lib/format";
import styles from "./Celebration.module.css";

type Moment = { miles: number; titles: string[]; rank: number };
type Seen = { reviewedAt: string; rank: number };

const storageKey = (userId: string) => `prokachka:celebrated:${userId}`;
function readSeen(userId: string): Seen | null {
  try { const value = JSON.parse(window.localStorage.getItem(storageKey(userId)) || "null"); return value && typeof value.reviewedAt === "string" ? value : null; }
  catch { return null; }
}
function writeSeen(userId: string, seen: Seen) {
  try { window.localStorage.setItem(storageKey(userId), JSON.stringify(seen)); } catch { /* Private mode: celebrate again next time. */ }
}

// Pure so it can be tested: what is new since the last visit on this device.
export function newMoment(submissions: Submission[], userId: string, rank: number, seen: Seen | null, now = new Date().toISOString()): { moment: Moment | null; seen: Seen } {
  const accepted = submissions.filter((item) => item.userId === userId && item.status === "accepted" && item.interactiveCompleted !== false && item.reviewedAt);
  const latest = accepted.reduce((max, item) => item.reviewedAt! > max ? item.reviewedAt! : max, "");
  // The first visit only remembers the current state; old history is not celebrated.
  if (!seen) return { moment: null, seen: { reviewedAt: latest || now, rank } };
  const fresh = accepted.filter((item) => item.reviewedAt! > seen.reviewedAt);
  const rankUp = rank > 0 && seen.rank > 0 && rank < seen.rank ? rank : 0;
  const next = { reviewedAt: latest > seen.reviewedAt ? latest : seen.reviewedAt, rank: rank > 0 ? rank : seen.rank };
  if (!fresh.length && !rankUp) return { moment: null, seen: next };
  return { moment: { miles: fresh.reduce((sum, item) => sum + item.points, 0), titles: fresh.map((item) => item.taskTitle || "Задание"), rank: rankUp }, seen: next };
}

export function CelebrationWatcher({ userId, submissions, rank }: { userId: string; submissions: Submission[]; rank: number }) {
  const [moment, setMoment] = useState<Moment | null>(null);
  useEffect(() => {
    // A short pause lets the screen settle; re-renders inside it reschedule instead of losing the moment.
    const timer = window.setTimeout(() => {
      const result = newMoment(submissions, userId, rank, readSeen(userId));
      writeSeen(userId, result.seen);
      if (result.moment) setMoment((current) => current ? { miles: current.miles + result.moment!.miles, titles: [...current.titles, ...result.moment!.titles], rank: result.moment!.rank || current.rank } : result.moment);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [userId, submissions, rank]);
  return moment ? <Celebration moment={moment} onClose={() => setMoment(null)} /> : null;
}

const colors = ["#e7b85b", "#3151a3", "#24866d", "#d68d15", "#8fa8ec", "#f0c9d4"];

function Celebration({ moment, onClose }: { moment: Moment; onClose: () => void }) {
  const miles = useCountUp(moment.miles, 900, 0);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus({ preventScroll: true }); }, []);
  const title = moment.titles.length === 1 ? "Работа принята!" : moment.titles.length > 1 ? `Принято работ: ${moment.titles.length}` : "Новое место в рейтинге!";
  return <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <div className={styles.confetti} aria-hidden="true">
      {Array.from({ length: 36 }, (_, index) => <i key={index} style={{
        "--x": `${(index * 37) % 100}%`, "--delay": `${(index % 9) * 0.07}s`, "--spin": `${(index % 2 ? 1 : -1) * (240 + (index * 53) % 360)}deg`,
        "--drift": `${((index * 29) % 60) - 30}px`, "--fall": `${1.6 + (index % 5) * 0.25}s`, "--color": colors[index % colors.length],
      } as CSSProperties} />)}
    </div>
    <section className={styles.card} role="dialog" aria-modal="true" aria-labelledby="celebration-title">
      {moment.miles > 0 ? <p className={styles.amount}><b>+{miles}</b><span>{milesUnit(miles)}</span></p>
        : moment.rank > 0 && !moment.titles.length ? <p className={styles.amount}><b>{moment.rank}</b><span>место</span></p>
        : <p className={styles.amount}><b aria-hidden="true">✓</b></p>}
      <h2 id="celebration-title">{title}</h2>
      {moment.titles.length > 0 && <p className={styles.tasks}>{moment.titles.slice(0, 2).map((name) => `«${name}»`).join(", ")}{moment.titles.length > 2 ? ` и ещё ${moment.titles.length - 2}` : ""}</p>}
      {moment.rank > 0 && moment.titles.length > 0 && <p className={styles.rank}><span aria-hidden="true">↑</span> Новое место в рейтинге: {moment.rank}</p>}
      <button ref={button} type="button" className={styles.close} onClick={onClose}>Отлично!</button>
    </section>
  </div>;
}
