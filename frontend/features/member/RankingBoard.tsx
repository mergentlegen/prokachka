"use client";

import type { RankEntry } from "@/shared/domain/types";
import { Avatar } from "@/frontend/shared/Avatar";
import { useCountUp } from "@/frontend/shared/hooks/use-count-up";
import { milesUnit } from "@/frontend/shared/lib/format";
import { COURSE_MAX, overtake } from "@/shared/domain/star-course";
import { levelLabel } from "@/shared/domain/levels";
import { plural, rankGap } from "./member-progress";
import styles from "./RankingBoard.module.css";

const starsUnit = (count: number) => plural(count, "звезда", "звезды", "звёзд");

/** «До 2-го места — 15 курса: 15 миль или 1 звезда». */
export function overtakeText(me: RankEntry, ahead: RankEntry) {
  const need = overtake(me, ahead);
  if (need.onlyStars) return me.points >= COURSE_MAX ? `ещё ${need.stars} ${starsUnit(need.stars)}` : `дойди до ${COURSE_MAX} и набери больше звёзд`;
  const ways = [need.miles ? `${need.miles} ${milesUnit(need.miles)}` : "", need.stars ? `${need.stars} ${starsUnit(need.stars)}` : ""].filter(Boolean);
  return `${need.course} курса${ways.length ? `: ${ways.join(" или ")}` : ""}`;
}

const totals = (member: RankEntry) => <small className={styles.totals}>⭐ {member.stars ?? 0} · ✈️ {member.miles ?? 0}</small>;

/** The rating of one level: only those on it, with that level's miles and stars. */
export function RankingBoard({ ranking, userId, level = 1 }: { ranking: RankEntry[]; userId: string; level?: number }) {
  const podium = ranking.length >= 3 ? ranking.slice(0, 3) : [];
  const rest = ranking.slice(podium.length);
  const me = rankGap(ranking, userId);
  return <>
    <div className="section-heading ranking-heading">
      <div className="ranking-title"><div><p className="eyebrow">{level > 1 ? levelLabel(level) : "Команда"}</p><h2>Звёздный курс</h2><p className={styles.formula}>Курс = мили + звёзды × 20 · до {COURSE_MAX}</p></div><span className="trophy">♛</span></div>
    </div>
    {ranking.length === 0 ? <div className="empty-state"><span>◌</span><p>Рейтинг пока пуст.</p></div> : <>
      {podium.length > 0 && <ol className={styles.podium} aria-label="Первая тройка">
        {[podium[1], podium[0], podium[2]].map((member) => {
          const place = podium.indexOf(member) + 1;
          return <li key={member.id} className={`rank-podium ${styles.place} ${styles[`place${place}`]} ${member.id === userId ? styles.mine : ""}`}>
            <span className={styles.avatarWrap}>{place === 1 && <span className={styles.crown} aria-hidden="true">♛</span>}<Avatar className={styles.avatar} name={member.name} src={member.avatarUrl} /></span>
            <span className={styles.name}>{member.name}{member.id === userId && <small>это вы</small>}</span>
            <strong>{member.points}<small> курса</small></strong>
            {totals(member)}
            <span className={styles.step} aria-label={`${place} место`}>{place}</span>
          </li>;
        })}
      </ol>}
      {rest.length > 0 && <div className="ranking-list">{rest.map((member, index) => <div className={`rank-row ${member.id === userId ? "current" : ""}`} key={member.id}>
        <span className={`rank-position rank-${index + podium.length + 1}`}>{index + podium.length + 1}</span>
        <Avatar className="rank-avatar" name={member.name} src={member.avatarUrl} />
        <span className={`rank-name ${styles.rowName}`}>{member.name}{member.id === userId && <small>это вы</small>}{totals(member)}</span>
        <strong>{member.points}<small className={styles.unit}> курса</small></strong>
      </div>)}</div>}
      {me && <MyPlace place={me.place} points={me.points} next={me.ahead ? `До ${me.place - 1}-го места — ${overtakeText(ranking[me.place - 1], me.ahead)}` : ""} />}
    </>}
  </>;
}

function MyPlace({ place, points, next }: { place: number; points: number; next: string }) {
  const shownPoints = useCountUp(points);
  return <div className={styles.me} role="status">
    <span className={styles.mePlace}><b>{place}</b><small>место</small></span>
    <span className={styles.meText}>
      <strong>{shownPoints} из {COURSE_MAX} курса</strong>
      <small>{next || "Ты на первом месте — так держать!"}</small>
    </span>
  </div>;
}
