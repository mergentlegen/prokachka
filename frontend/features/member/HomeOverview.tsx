"use client";

import type { ReactNode } from "react";
import type { RankEntry, Submission, Task } from "@/shared/domain/types";
import { milesUnit } from "@/frontend/shared/lib/format";
import { useCountUp } from "@/frontend/shared/hooks/use-count-up";
import { memberNavIcons, type MemberNavTab } from "./MemberNav";
import { deadlineInfo, focusTasks, latestSubmissions, milesSince, plural, rankGap, taskDeadline } from "./member-progress";
import styles from "./HomeOverview.module.css";

const WEEK = 7 * 86_400_000;

// Four compact shortcuts under the score card: each shows one live number and opens its section.
export function HomeOverview({ userId, tasks, submissions, ranking, feedbackUnread, now, onOpen }: {
  userId: string; tasks: Task[]; submissions: Submission[]; ranking: RankEntry[]; feedbackUnread: number; now: number;
  onOpen: (tab: MemberNavTab) => void;
}) {
  const todo = focusTasks(tasks, latestSubmissions(submissions, userId), now);
  const nearest = todo.map((task) => deadlineInfo(taskDeadline(task), now)).find(Boolean);
  const todoCount = useCountUp(todo.length);
  const week = useCountUp(milesSince(submissions, userId, now - WEEK));
  const position = rankGap(ranking, userId);
  const gap = useCountUp(position?.gap ?? 0);
  const unread = useCountUp(feedbackUnread);
  return <nav className={styles.grid} aria-label="Быстрый переход">
    <Tile icon={memberNavIcons.tasks} onClick={() => onOpen("tasks")} tone={todo.length ? "blue" : "green"} value={todo.length ? todoCount : "✓"}
      label={todo.length ? `${plural(todo.length, "задание ждёт", "задания ждут", "заданий ждут")}` : "Всё выполнено"}
      note={nearest ? <span className={`${styles.chip} ${styles[nearest.tone]}`}>{nearest.text}</span> : todo.length ? "без срока" : "новые появятся здесь"} />
    <Tile icon={memberNavIcons.feedback} onClick={() => onOpen("feedback")} tone={feedbackUnread ? "gold" : "plain"} value={feedbackUnread ? unread : "0"} pulse={feedbackUnread > 0}
      label={feedbackUnread ? plural(feedbackUnread, "новый ответ", "новых ответа", "новых ответов") : "новых ответов нет"} note="от наставника" />
    {position?.ahead
      ? <Tile icon={memberNavIcons.ranking} onClick={() => onOpen("ranking")} tone="plain" value={gap} label={`${milesUnit(position.gap)} до ${position.place - 1}-го места`} note={`сейчас ${position.place}-е место`} />
      : <Tile icon={memberNavIcons.ranking} onClick={() => onOpen("ranking")} tone="plain" value={position ? "1" : "—"} label={position ? "место в рейтинге" : "рейтинг"} note={position ? "ты лидер!" : "пока без места"} />}
    <Tile icon={<span className={styles.trend} aria-hidden="true">↗</span>} onClick={() => onOpen("ranking")} tone="green" value={`+${week}`} label={`${milesUnit(week)} за 7 дней`} note="твой темп" />
  </nav>;
}

function Tile({ icon, onClick, tone, value, label, note, pulse }: {
  icon: ReactNode; onClick: () => void; tone: "blue" | "green" | "gold" | "plain"; value: ReactNode; label: string; note: ReactNode; pulse?: boolean;
}) {
  return <button type="button" className={`${styles.tile} ${styles[tone]}`} onClick={onClick}>
    <span className={styles.icon}>{icon}{pulse && <i className={styles.pulse} aria-hidden="true" />}</span>
    <strong>{value}</strong>
    <span className={styles.label}>{label}</span>
    <span className={styles.note}>{note}</span>
  </button>;
}
