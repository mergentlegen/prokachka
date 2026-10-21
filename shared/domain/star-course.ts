import type { RankEntry } from "./types";

// «Звёздный курс» — the only team rating. Miles and stars stay personal counters everywhere else;
// the course takes at most 100 miles and 10 stars, a star is worth 20, so the course ends at 300.
export const COURSE_MILES = 100;
export const COURSE_STARS = 10;
export const STAR_VALUE = 20;
export const COURSE_MAX = COURSE_MILES + COURSE_STARS * STAR_VALUE;

export function starCourse(miles: number, stars: number) {
  return Math.min(Math.max(miles, 0), COURSE_MILES) + Math.min(Math.max(stars, 0), COURSE_STARS) * STAR_VALUE;
}

type Standing = Pick<RankEntry, "id" | "name" | "avatarUrl"> & { miles: number; stars: number; level?: number };

/** One row per participant: course first; on a tie more stars (all of them, also above 10), then the name. */
export function courseRanking(rows: readonly Standing[]): RankEntry[] {
  return rows.map((row) => ({ id: row.id, name: row.name, avatarUrl: row.avatarUrl, points: starCourse(row.miles, row.stars), miles: row.miles, stars: row.stars, ...(row.level ? { level: row.level } : {}) }))
    .sort((a, b) => b.points - a.points || b.stars - a.stars || a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id));
}

/**
 * What it takes to pass the person directly above: course points, and whether miles alone or stars alone get there.
 * At the very top (300) only more stars overtake, so then it is the number of stars.
 */
export function overtake(me: RankEntry, ahead: RankEntry) {
  const milesLeft = COURSE_MILES - Math.min(me.miles ?? 0, COURSE_MILES);
  const starsLeft = COURSE_STARS - Math.min(me.stars ?? 0, COURSE_STARS);
  const room = milesLeft + starsLeft * STAR_VALUE;
  const course = ahead.points - me.points + 1;
  if (course > room) {
    // Already as far as the course goes (or ahead is at 300): reach 300, then have more stars.
    const stars = Math.max(1, (ahead.stars ?? 0) - (me.stars ?? 0) + 1);
    return { course: 0, miles: null, stars, onlyStars: true as const };
  }
  const starsNeeded = Math.ceil(course / STAR_VALUE);
  return { course, miles: course <= milesLeft ? course : null, stars: starsNeeded <= starsLeft ? starsNeeded : null, onlyStars: false as const };
}
