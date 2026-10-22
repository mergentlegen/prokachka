"use client";

import type { CSSProperties } from "react";
import { CountUp } from "@/frontend/shared/hooks/use-count-up";
import { COURSE_MAX, COURSE_MILES, COURSE_STARS, STAR_VALUE, starCourse } from "@/shared/domain/star-course";
import { MAX_LEVEL, levelTitle } from "@/shared/domain/levels";
import styles from "./StarCourseCard.module.css";

/** The participant's own «Опыт» (XP, formerly «Звёздный курс»): the total out of 300 XP and the two «fuels» it is made of. */
/** `level` — the participant's level; miles and stars are that level's. */
export function StarCourseCard({ miles, stars, rank, level = 1, onOpenRanking }: { miles: number; stars: number; rank: number; level?: number; onOpenRanking: () => void }) {
  const course = starCourse(miles, stars);
  const courseStars = Math.min(stars, COURSE_STARS), courseMiles = Math.min(miles, COURSE_MILES);
  const done = course >= COURSE_MAX;
  const next = level < MAX_LEVEL ? ` ${COURSE_MAX} XP — переход на уровень ${level + 1}.` : "";
  const hint = done ? "300 XP набрано! Дальше в рейтинге выше тот, у кого больше звёзд."
    : courseStars >= COURSE_STARS ? `Звёзды набраны. Добирай мили: каждая миля = +1 XP.${next}`
      : `Следующая звезда = +${STAR_VALUE} XP. Один PREMIUM = +${5 * STAR_VALUE} XP.${next}`;
  return <div className={`score-card ${styles.course} ${done ? styles.done : ""}`}>
    <span className="score-label">{done ? "Опыт набран ✓" : "Опыт"}{level > 1 && <b className={styles.level}>Уровень {level}{level === 2 ? ` · ${levelTitle(level)}` : ""}</b>}</span>
    <div className="score-value"><strong><CountUp value={course} /></strong><span className="score-unit">из {COURSE_MAX} XP</span></div>
    <div className={styles.bar} role="progressbar" aria-label="Опыт, XP" aria-valuemin={0} aria-valuemax={COURSE_MAX} aria-valuenow={course}>
      <span style={{ "--part": `${(courseMiles / COURSE_MAX) * 100}%` } as CSSProperties} className={styles.milesPart} />
      <span style={{ "--part": `${(courseStars * STAR_VALUE / COURSE_MAX) * 100}%` } as CSSProperties} className={styles.starsPart} />
    </div>
    <ul className={styles.fuel}>
      <li><span><i aria-hidden="true">⭐</i>{courseStars}/{COURSE_STARS} звёзд</span><b>→ {courseStars * STAR_VALUE} XP</b></li>
      <li><span><i aria-hidden="true">✈️</i>{courseMiles}/{COURSE_MILES} миль</span><b>→ {courseMiles} XP</b></li>
    </ul>
    <p className={styles.hint}>{hint}</p>
    <button type="button" className={`rank-line ${styles.rank}`} onClick={onOpenRanking}>{rank ? `${rank} место в рейтинге` : "Пока нет места в рейтинге"} <i>↗</i></button>
  </div>;
}
