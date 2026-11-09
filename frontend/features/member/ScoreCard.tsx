"use client";

import type { CSSProperties } from "react";
import { CountUp } from "@/frontend/shared/hooks/use-count-up";
import { milesUnit } from "@/frontend/shared/lib/format";
import { LEVEL_UP_MILES, levelTitle } from "@/shared/domain/levels";
import type { RatingMetric } from "./RankingBoard";
import { plural } from "./member-progress";
import styles from "./ScoreCard.module.css";

/** The participant's own result on the home page: miles or stars (as the rating shows), the place, and the way to level 2. */
export function ScoreCard({ metric, miles, stars, rank, level = 1, onOpenRanking }: { metric: RatingMetric; miles: number; stars: number; rank: number; level?: number; onOpenRanking: () => void }) {
  const left = Math.max(LEVEL_UP_MILES - miles, 0);
  return <div className={`score-card ${styles.card}`}>
    <span className="score-label">Общий результат{level > 1 && <b className={styles.level}>Уровень {level}{level === 2 ? ` · ${levelTitle(level)}` : ""}</b>}</span>
    <div className={"score-value " + (metric === "stars" ? "is-stars" : "")}><strong><CountUp value={metric === "stars" ? stars : miles} /></strong><span className="score-unit">{metric === "stars" ? `★ ${plural(stars, "звезда", "звезды", "звёзд")}` : milesUnit(miles)}</span></div>
    {level === 1 && left > 0 && <div className={styles.next}>
      <span className={styles.bar} role="progressbar" aria-label={`Мили до уровня 2 «${levelTitle(2)}»`} aria-valuemin={0} aria-valuemax={LEVEL_UP_MILES} aria-valuenow={Math.min(miles, LEVEL_UP_MILES)}><i style={{ "--part": `${(Math.min(miles, LEVEL_UP_MILES) / LEVEL_UP_MILES) * 100}%` } as CSSProperties} /></span>
      <small>До уровня «{levelTitle(2)}» — {left} {milesUnit(left)}</small>
    </div>}
    <button type="button" className={`rank-line ${styles.rank}`} onClick={onOpenRanking}>{rank ? `${rank} место в рейтинге` : "Пока нет места в рейтинге"} <i>↗</i></button>
  </div>;
}
