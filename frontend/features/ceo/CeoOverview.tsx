"use client";

import { useState, type ReactNode } from "react";
import type { Team, TeamJoinRequest, User } from "@/shared/domain/types";
import type { CeoJournalEntry, CeoStats } from "@/frontend/shared/api/ceo-client";
import { CountUp } from "@/frontend/shared/hooks/use-count-up";
import { DailyBars } from "@/frontend/shared/DailyBars";
import { plural } from "@/frontend/shared/lib/plural";
import { ceoIcons } from "./CeoIcons";
import { CeoRecentActions } from "./CeoJournal";
import { attentionItems, daysFromStats, formatHours, teamHealth, type Health } from "./ceo-insights";
import styles from "./CeoOverview.module.css";

export type CeoSection = "overview" | "teams" | "requests" | "users" | "journal";
export const healthLabels: Record<Health, string> = { growing: "Растёт", steady: "Стабильно", quiet: "Затихла", empty: "Пока пусто" };

export function CeoOverview({ teams, users, requests, stats, journal = [], onNavigate, onOpenTeam }: {
  teams: Team[]; users: User[]; requests: TeamJoinRequest[]; stats: CeoStats | null; journal?: CeoJournalEntry[]; onNavigate: (section: CeoSection) => void; onOpenTeam: (teamId: string) => void;
}) {
  const [series, setSeries] = useState<"submissions" | "newUsers">("submissions");
  const attention = attentionItems({ teams, users, requests, stats });
  const tiles: Array<{ id: string; section: CeoSection; count: number; label: string; note: string; icon: ReactNode; tone: "red" | "gold" | "blue" | "plain" }> = [
    { id: "noMentor", section: "teams" as const, count: attention.noMentor.length, label: plural(attention.noMentor.length, "команда без наставника", "команды без наставника", "команд без наставника"), note: attention.noMentor.map((team) => team.name).join(", "), icon: ceoIcons.mentor, tone: "red" as const },
    { id: "slow", section: "teams" as const, count: attention.slowReview.length, label: plural(attention.slowReview.length, "команда тянет с проверкой", "команды тянут с проверкой", "команд тянут с проверкой"), note: "работы ждут больше 2 дней", icon: ceoIcons.clock, tone: "red" as const },
    { id: "quiet", section: "teams" as const, count: attention.quiet.length, label: plural(attention.quiet.length, "команда затихла", "команды затихли", "команд затихли"), note: "нет работ 7 дней", icon: ceoIcons.quiet, tone: "gold" as const },
    { id: "requests", section: "requests" as const, count: attention.oldRequests.length, label: plural(attention.oldRequests.length, "заявка ждёт больше суток", "заявки ждут больше суток", "заявок ждут больше суток"), note: "нужно решение", icon: ceoIcons.requests, tone: "blue" as const },
    { id: "noTeam", section: "users" as const, count: attention.withoutTeam.length, label: plural(attention.withoutTeam.length, "человек без команды", "человека без команды", "человек без команды"), note: "не видят задания", icon: ceoIcons.users, tone: "plain" as const },
  ].filter((tile) => tile.count > 0);

  const byTeam = new Map((stats?.teams || []).map((item) => [item.teamId, item]));
  const works7 = (stats?.teams || []).reduce((sum, item) => sum + item.submissions7, 0);
  const days = daysFromStats(stats, series);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const ranked = teams.filter((team) => team.isActive).sort((a, b) => (byTeam.get(b.id)?.submissions7 || 0) - (byTeam.get(a.id)?.submissions7 || 0) || a.name.localeCompare(b.name, "ru"));

  return <div className={styles.overview}>
    <section aria-labelledby="ceo-attention">
      <h2 id="ceo-attention" className={styles.title}>Требует внимания</h2>
      {tiles.length ? <div className={styles.attention}>{tiles.map((tile) => <button type="button" key={tile.id} className={`${styles.tile} ${styles[tile.tone]}`} onClick={() => onNavigate(tile.section)}>
        <span className={styles.icon}>{tile.icon}</span><strong><CountUp value={tile.count} /></strong><span className={styles.label}>{tile.label}</span><span className={styles.note}>{tile.note}</span>
      </button>)}</div> : <div className={styles.calm}><span aria-hidden="true">✓</span><div><strong>Всё под контролем</strong><p>У всех команд есть наставники, работы проверяются вовремя, заявки разобраны.</p></div></div>}
    </section>

    <div className={styles.metrics}>
      <Metric icon={ceoIcons.teams} value={teams.filter((team) => team.isActive).length} label="активных команд" />
      <Metric icon={ceoIcons.users} value={users.filter((user) => user.role !== "ceo").length} label="пользователей" />
      <Metric icon={ceoIcons.works} value={works7} label="работ за неделю" />
      <Metric icon={ceoIcons.clock} value={formatHours(stats?.platform.avgReviewHours ?? null)} label="в среднем ждёт проверка" />
    </div>

    <DailyBars title={series === "submissions" ? "Работы за 30 дней" : "Новые участники за 30 дней"} caption={series === "submissions" ? "Работы по дням" : "Новые участники по дням"} days={days}
      unit={series === "submissions" ? ["работа", "работы", "работ"] : ["человек", "человека", "человек"]}
      summary={stats ? `${total} ${series === "submissions" ? plural(total, "работа", "работы", "работ") : plural(total, "новый участник", "новых участника", "новых участников")} по всей платформе` : "Считаем…"}
      actions={<div className={styles.switch} role="group" aria-label="Что показать">
        <button type="button" className={series === "submissions" ? styles.on : ""} aria-pressed={series === "submissions"} onClick={() => setSeries("submissions")}>Работы</button>
        <button type="button" className={series === "newUsers" ? styles.on : ""} aria-pressed={series === "newUsers"} onClick={() => setSeries("newUsers")}>Новые</button>
      </div>} />

    <section className={styles.panel} aria-labelledby="ceo-teams-compare">
      <div className={styles.panelHead}><h2 id="ceo-teams-compare">Как живут команды</h2><p>за последнюю неделю, сверху самые активные</p></div>
      {ranked.length === 0 ? <p className={styles.emptyNote}>Активных команд пока нет.</p> : <ul className={styles.teams}>{ranked.map((team) => {
        const item = byTeam.get(team.id);
        const health = teamHealth(item);
        const waitingDays = item?.oldestPendingAt && stats ? Math.floor((Date.parse(stats.generatedAt) - Date.parse(item.oldestPendingAt)) / 86_400_000) : 0;
        return <li key={team.id}><button type="button" onClick={() => onOpenTeam(team.id)}>
          <span className={styles.teamTop}><strong>{team.name}</strong><em className={styles[health]}>{healthLabels[health]}</em></span>
          <span className={styles.teamNumbers}>
            <span><b>{item?.members ?? 0}</b> участн.</span>
            <span><b>{item?.active14 ?? 0}</b> активны</span>
            <span><b>{item?.submissions7 ?? 0}</b> работ</span>
            <span><b>+{item?.newMembers30 ?? 0}</b> за месяц</span>
          </span>
          <span className={styles.teamBar} aria-hidden="true"><i style={{ width: `${item?.members ? Math.round((item.active14 / item.members) * 100) : 0}%` }} /></span>
          <span className={styles.teamFoot}>Проверка: {formatHours(item?.avgReviewHours ?? null)}{item?.pending ? <> · <b className={waitingDays >= 2 ? styles.late : ""}>{item.pending} ждут{waitingDays >= 1 ? `, до ${waitingDays} дн.` : ""}</b></> : " · очередь пуста"}</span>
        </button></li>;
      })}</ul>}
    </section>
    <CeoRecentActions entries={journal} onOpen={() => onNavigate("journal")} />
  </div>;
}

function Metric({ icon, value, label }: { icon: ReactNode; value: number | string; label: string }) {
  return <div className={styles.metric}><span className={styles.icon}>{icon}</span><strong>{typeof value === "number" ? <CountUp value={value} /> : value}</strong><small>{label}</small></div>;
}
