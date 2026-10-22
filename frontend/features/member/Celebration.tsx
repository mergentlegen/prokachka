"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Submission } from "@/shared/domain/types";
import { useCountUp } from "@/frontend/shared/hooks/use-count-up";
import { milesUnit } from "@/frontend/shared/lib/format";
import { COURSE_MAX } from "@/shared/domain/star-course";
import styles from "./Celebration.module.css";

type Moment = { miles: number; titles: string[]; rank: number; course?: boolean };
// `metric` marks places counted by XP («Опыт», formerly «Звёздный курс»); an older place (by miles) is not compared with it.
type Seen = { reviewedAt: string; rank: number; metric?: "course"; courseDone?: boolean };

const storageKey = (userId: string) => `prokachka:celebrated:${userId}`;
function readSeen(userId: string): Seen | null {
  try { const value = JSON.parse(window.localStorage.getItem(storageKey(userId)) || "null"); return value && typeof value.reviewedAt === "string" ? value : null; }
  catch { return null; }
}
function writeSeen(userId: string, seen: Seen) {
  try { window.localStorage.setItem(storageKey(userId), JSON.stringify(seen)); } catch { /* Private mode: celebrate again next time. */ }
}

// Pure so it can be tested: what is new since the last visit on this device.
export function newMoment(submissions: Submission[], userId: string, rank: number, seen: Seen | null, now = new Date().toISOString(), courseDone = false): { moment: Moment | null; seen: Seen } {
  const accepted = submissions.filter((item) => item.userId === userId && item.status === "accepted" && item.interactiveCompleted !== false && item.reviewedAt);
  const latest = accepted.reduce((max, item) => item.reviewedAt! > max ? item.reviewedAt! : max, "");
  // The first visit only remembers the current state; old history is not celebrated.
  if (!seen) return { moment: null, seen: { reviewedAt: latest || now, rank, metric: "course", courseDone } };
  const fresh = accepted.filter((item) => item.reviewedAt! > seen.reviewedAt);
  const seenRank = seen.metric === "course" ? seen.rank : 0;
  const rankUp = rank > 0 && seenRank > 0 && rank < seenRank ? rank : 0;
  // «300 XP набрано» is celebrated once per device (a brand-new device only remembers the state).
  const course = courseDone && !seen.courseDone;
  const next: Seen = { reviewedAt: latest > seen.reviewedAt ? latest : seen.reviewedAt, rank: rank > 0 ? rank : seenRank, metric: "course", courseDone: courseDone || Boolean(seen.courseDone) };
  if (!fresh.length && !rankUp && !course) return { moment: null, seen: next };
  return { moment: { miles: fresh.reduce((sum, item) => sum + item.points, 0), titles: fresh.map((item) => item.taskTitle || "Задание"), rank: rankUp, ...(course ? { course } : {}) }, seen: next };
}

export function CelebrationWatcher({ userId, submissions, rank, courseDone = false }: { userId: string; submissions: Submission[]; rank: number; courseDone?: boolean }) {
  const [moment, setMoment] = useState<Moment | null>(null);
  useEffect(() => {
    // A short pause lets the screen settle; re-renders inside it reschedule instead of losing the moment.
    const timer = window.setTimeout(() => {
      const result = newMoment(submissions, userId, rank, readSeen(userId), undefined, courseDone);
      writeSeen(userId, result.seen);
      if (result.moment) setMoment((current) => current ? { miles: current.miles + result.moment!.miles, titles: [...current.titles, ...result.moment!.titles], rank: result.moment!.rank || current.rank, course: result.moment!.course || current.course } : result.moment);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [userId, submissions, rank, courseDone]);
  return moment ? <Celebration moment={moment} onClose={() => setMoment(null)} /> : null;
}

const colors = ["#e7b85b", "#3151a3", "#24866d", "#d68d15", "#8fa8ec", "#f0c9d4"];

function Celebration({ moment, onClose }: { moment: Moment; onClose: () => void }) {
  const miles = useCountUp(moment.miles, 900, 0);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus({ preventScroll: true }); }, []);
  const title = moment.titles.length === 1 ? "Работа принята!" : moment.titles.length > 1 ? `Принято работ: ${moment.titles.length}` : moment.course ? "300 XP набрано!" : "Новое место в рейтинге!";
  return <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <div className={styles.confetti} aria-hidden="true">
      {Array.from({ length: 36 }, (_, index) => <i key={index} style={{
        "--x": `${(index * 37) % 100}%`, "--delay": `${(index % 9) * 0.07}s`, "--spin": `${(index % 2 ? 1 : -1) * (240 + (index * 53) % 360)}deg`,
        "--drift": `${((index * 29) % 60) - 30}px`, "--fall": `${1.6 + (index % 5) * 0.25}s`, "--color": colors[index % colors.length],
      } as CSSProperties} />)}
    </div>
    <section className={styles.card} role="dialog" aria-modal="true" aria-labelledby="celebration-title">
      {moment.miles > 0 ? <p className={styles.amount}><b>+{miles}</b><span>{milesUnit(miles)}</span></p>
        : moment.course ? <p className={styles.amount}><b>{COURSE_MAX}</b><span>из {COURSE_MAX} XP</span></p>
        : moment.rank > 0 && !moment.titles.length ? <p className={styles.amount}><b>{moment.rank}</b><span>место</span></p>
        : <p className={styles.amount}><b aria-hidden="true">✓</b></p>}
      <h2 id="celebration-title">{title}</h2>
      {moment.titles.length > 0 && <p className={styles.tasks}>{moment.titles.slice(0, 2).map((name) => `«${name}»`).join(", ")}{moment.titles.length > 2 ? ` и ещё ${moment.titles.length - 2}` : ""}</p>}
      {moment.course && (moment.titles.length > 0 || moment.miles > 0) && <p className={styles.rank}><span aria-hidden="true">★</span> Опыт набран: {COURSE_MAX} из {COURSE_MAX} XP</p>}
      {moment.rank > 0 && (moment.titles.length > 0 || moment.course) && <p className={styles.rank}><span aria-hidden="true">↑</span> Новое место в рейтинге: {moment.rank}</p>}
      <button ref={button} type="button" className={styles.close} onClick={onClose}>Отлично!</button>
    </section>
  </div>;
}
