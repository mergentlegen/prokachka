"use client";

import type { ReactNode } from "react";
import type { Store, Submission } from "@/shared/domain/types";
import { Avatar } from "@/frontend/shared/Avatar";
import { DailyBars } from "@/frontend/shared/DailyBars";
import { CountUp } from "@/frontend/shared/hooks/use-count-up";
import { formatDate, milesUnit } from "@/frontend/shared/lib/format";
import { adminIcons } from "./AdminIcons";
import type { AdminSection } from "./admin-sections";
import { dailyActivity, newMembers, plural, quietMembers, waitingInfo, weeklyLeaders } from "./review-queue";
import styles from "./AdminDashboard.module.css";

type Props = {
  store: Store; queue: Submission[]; feedbackNeedsReply: number; requests: number; canReview: boolean; now: number;
  onNavigate: (section: AdminSection) => void;
};

type AttentionItem = { id: string; section: AdminSection; count: number; label: string; note: ReactNode; tone: "blue" | "gold" | "red" | "plain" };

export function AdminDashboard({ store, queue, feedbackNeedsReply, requests, canReview, now, onNavigate }: Props) {
  const members = store.users.filter((user) => user.role === "member");
  const quiet = canReview ? quietMembers(members, store.submissions, now) : [];
  const oldest = queue[0] ? waitingInfo(queue[0].submittedAt, now) : null;
  const acceptedWeek = store.submissions.filter((item) => item.status === "accepted" && item.reviewedAt && Date.parse(item.reviewedAt) >= now - 7 * 86_400_000).length;
  const items: AttentionItem[] = [
    { id: "review", section: "review", count: queue.length, label: plural(queue.length, "работа ждёт проверки", "работы ждут проверки", "работ ждут проверки"),
      note: oldest && <span className={`${styles.chip} ${styles[oldest.tone]}`}>самая старая {oldest.text}</span>, tone: oldest?.tone === "late" ? "red" : "blue" },
    { id: "feedback", section: "feedback", count: feedbackNeedsReply, label: plural(feedbackNeedsReply, "переписка без ответа", "переписки без ответа", "переписок без ответа"), note: "участники ждут ответа", tone: "gold" },
    { id: "requests", section: "requests", count: requests, label: plural(requests, "заявка в команду", "заявки в команду", "заявок в команду"), note: "нужно принять или отклонить", tone: "blue" },
    { id: "quiet", section: "network", count: quiet.length, label: plural(quiet.length, "участник затих", "участника затихли", "участников затихли"), note: "нет работ 2+ недели", tone: "plain" },
  ];
  const attention = canReview ? items.filter((item) => item.count > 0) : [];

  return <div className={styles.dashboard}>
    {canReview && <section aria-labelledby="attention-title">
      <h2 id="attention-title" className={styles.title}>Требует внимания</h2>
      {attention.length ? <div className={styles.attention}>
        {attention.map((item) => <button type="button" key={item.id} className={`${styles.tile} ${styles[item.tone]}`} onClick={() => onNavigate(item.section)}>
          <span className={styles.icon}>{adminIcons[item.section]}</span>
          <strong><CountUp value={item.count} /></strong>
          <span className={styles.label}>{item.label}</span>
          <span className={styles.note}>{item.note}</span>
        </button>)}
      </div> : <div className={styles.calm}><span aria-hidden="true">✓</span><div><strong>Всё под контролем</strong><p>Работы проверены, на сообщения ответили, новых заявок нет.</p></div></div>}
    </section>}

    <div className={styles.stats}>
      <div><strong><CountUp value={members.length} /></strong><small>{plural(members.length, "участник", "участника", "участников")}</small></div>
      <div><strong><CountUp value={store.tasks.filter((task) => task.isActive && !(task.deadlineAt && Date.parse(task.deadlineAt) <= now)).length} /></strong><small>активных заданий</small></div>
      <div><strong><CountUp value={acceptedWeek} /></strong><small>принято за неделю</small></div>
    </div>

    <ActivityChart submissions={store.submissions} now={now} />

    <div className={styles.columns}>
      <WeekLeaders store={store} now={now} />
      <Newcomers store={store} now={now} />
    </div>
  </div>;
}

function ActivityChart({ submissions, now }: { submissions: Submission[]; now: number }) {
  const days = dailyActivity(submissions, 14, now);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  return <DailyBars title="Работы за 14 дней" caption="Работы по дням" days={days} unit={["работа", "работы", "работ"]}
    summary={total ? `${total} ${plural(total, "работа", "работы", "работ")} · в среднем ${(total / days.length).toFixed(1).replace(".", ",")} в день` : "Пока ни одной работы"} />;
}

function WeekLeaders({ store, now }: { store: Store; now: number }) {
  const leaders = weeklyLeaders(store.submissions, store.users, now);
  return <section className={styles.panel} aria-labelledby="leaders-title">
    <div className={styles.panelHead}><div><h2 id="leaders-title">Лидеры недели</h2><p>больше всего миль за 7 дней</p></div></div>
    {leaders.length ? <ol className={styles.people}>{leaders.map(({ user, miles }, index) => <li key={user.id}>
      <span className={`${styles.place} ${index < 3 ? styles[`place${index + 1}`] : ""}`}>{index + 1}</span>
      <Avatar className={styles.avatar} name={user.name} src={user.avatarUrl} />
      <span className={styles.name}>{user.name}</span>
      <b>+{miles} <small>{milesUnit(miles)}</small></b>
    </li>)}</ol> : <p className={styles.empty}>За эту неделю ещё никто не получил миль.</p>}
  </section>;
}

function Newcomers({ store, now }: { store: Store; now: number }) {
  const people = newMembers(store.users, now).slice(0, 6);
  return <section className={styles.panel} aria-labelledby="newcomers-title">
    <div className={styles.panelHead}><div><h2 id="newcomers-title">Новички</h2><p>вступили за последние 7 дней</p></div></div>
    {people.length ? <ul className={styles.people}>{people.map((user) => <li key={user.id}>
      <Avatar className={styles.avatar} name={user.name} src={user.avatarUrl} />
      <span className={styles.name}>{user.name}</span>
      <small>{formatDate(user.teamJoinedAt || user.createdAt)}</small>
    </li>)}</ul> : <p className={styles.empty}>Новых участников на этой неделе нет.</p>}
  </section>;
}
