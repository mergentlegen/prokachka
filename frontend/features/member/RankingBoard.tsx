"use client";

import type { RankEntry } from "@/shared/domain/types";
import { Avatar } from "@/frontend/shared/Avatar";
import { useCountUp } from "@/frontend/shared/hooks/use-count-up";
import { milesUnit } from "@/frontend/shared/lib/format";
import { plural, rankGap } from "./member-progress";
import styles from "./RankingBoard.module.css";

type Metric = "points" | "stars";
const unit = (metric: Metric, value: number) => metric === "stars" ? plural(value, "звезда", "звезды", "звёзд") : milesUnit(value);

export function RankingBoard({ ranking, metric, onMetric, userId }: { ranking: RankEntry[]; metric: Metric; onMetric: (metric: Metric) => void; userId: string }) {
  const podium = ranking.length >= 3 ? ranking.slice(0, 3) : [];
  const rest = ranking.slice(podium.length);
  const me = rankGap(ranking, userId);
  return <>
    <div className="section-heading ranking-heading">
      <div className="ranking-title"><div><p className="eyebrow">Команда</p><h2>Рейтинг</h2></div><span className="trophy">♛</span></div>
      <div className="rating-switch">
        <button className={metric === "points" ? "active" : ""} onClick={() => onMetric("points")}>Мили</button>
        <button className={metric === "stars" ? "active" : ""} onClick={() => onMetric("stars")}>Звёзды</button>
      </div>
    </div>
    {ranking.length === 0 ? <div className="empty-state"><span>◌</span><p>Рейтинг пока пуст.</p></div> : <>
      {podium.length > 0 && <ol className={styles.podium} aria-label="Первая тройка">
        {[podium[1], podium[0], podium[2]].map((member) => {
          const place = podium.indexOf(member) + 1;
          return <li key={member.id} className={`rank-podium ${styles.place} ${styles[`place${place}`]} ${member.id === userId ? styles.mine : ""}`}>
            <span className={styles.avatarWrap}>{place === 1 && <span className={styles.crown} aria-hidden="true">♛</span>}<Avatar className={styles.avatar} name={member.name} src={member.avatarUrl} /></span>
            <span className={styles.name}>{member.name}{member.id === userId && <small>это вы</small>}</span>
            <strong>{member.points}<small> {metric === "stars" ? "★" : unit(metric, member.points)}</small></strong>
            <span className={styles.step} aria-label={`${place} место`}>{place}</span>
          </li>;
        })}
      </ol>}
      {rest.length > 0 && <div className={"ranking-list " + (metric === "stars" ? "stars-ranking-list" : "")}>{rest.map((member, index) => <div className={`rank-row ${member.id === userId ? "current" : ""}`} key={member.id}>
        <span className={`rank-position rank-${index + podium.length + 1}`}>{index + podium.length + 1}</span>
        <Avatar className="rank-avatar" name={member.name} src={member.avatarUrl} />
        <span className="rank-name">{member.name}{member.id === userId && <small>это вы</small>}</span>
        <strong>{member.points}{metric === "stars" ? " ★" : ` ${milesUnit(member.points)}`}</strong>
      </div>)}</div>}
      {me && <MyPlace place={me.place} points={me.points} gap={me.gap} aheadPlace={me.ahead ? me.place - 1 : 0} metric={metric} />}
    </>}
  </>;
}

function MyPlace({ place, points, gap, aheadPlace, metric }: { place: number; points: number; gap: number; aheadPlace: number; metric: Metric }) {
  const shownPoints = useCountUp(points);
  const shownGap = useCountUp(gap);
  return <div className={styles.me} role="status">
    <span className={styles.mePlace}><b>{place}</b><small>место</small></span>
    <span className={styles.meText}>
      <strong>{shownPoints} {unit(metric, shownPoints)}</strong>
      <small>{aheadPlace ? `До ${aheadPlace}-го места: ${shownGap} ${unit(metric, shownGap)}` : "Ты на первом месте — так держать!"}</small>
    </span>
  </div>;
}
