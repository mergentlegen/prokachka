"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { formatDate } from "./lib/format";
import { plural } from "./lib/plural";
import styles from "./DailyBars.module.css";

const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });
const dayNumber = new Intl.DateTimeFormat("ru-RU", { day: "numeric" });
const fullDay = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" });

// One series, one color: thin columns from a shared baseline, the busiest day and today labelled,
// every value in the tooltip and in a hidden table for screen readers.
export function DailyBars({ title, caption, days, unit, summary, actions }: {
  title: string; caption: string; days: Array<{ date: Date; count: number }>; unit: [string, string, string]; summary?: ReactNode; actions?: ReactNode;
}) {
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const max = Math.max(1, ...days.map((day) => day.count));
  const peak = days.reduce((best, day, index) => day.count > days[best].count ? index : best, 0);
  const today = days.length - 1;
  const dense = days.length > 16;
  const words = (count: number) => plural(count, ...unit);
  return <section className={styles.panel} aria-labelledby={titleId}>
    <div className={styles.head}>
      <div><h2 id={titleId}>{title}</h2>{summary && <p>{summary}</p>}</div>
      {actions}
    </div>
    <div className={styles.chart} style={{ "--days": days.length } as CSSProperties} onMouseLeave={() => setActive(null)}>
      {days.map((day, index) => {
        const showValue = day.count > 0 && (index === peak || index === today);
        const showDay = !dense || index === today || (today - index) % 5 === 0;
        return <button type="button" key={day.date.toISOString()} className={`${styles.column} ${active === index ? styles.activeColumn : ""}`} aria-label={`${fullDay.format(day.date)}: ${day.count} ${words(day.count)}`}
          onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(active === index ? null : index)}>
          <span className={styles.plot}>
            {active === index && <span className={`${styles.tooltip} ${index < 3 ? styles.left : index > days.length - 4 ? styles.right : ""}`} role="tooltip"><b>{day.count}</b> {words(day.count)}<small>{formatDate(day.date.toISOString())}</small></span>}
            {day.count > 0 && <i style={{ height: `${(day.count / max) * 100}%` }}>{showValue && active !== index && <span className={styles.value}>{day.count}</span>}</i>}
          </span>
          <span className={`${styles.day} ${index === today ? styles.today : ""}`}>{index === today ? "сег." : showDay ? dense ? dayNumber.format(day.date) : weekday.format(day.date).slice(0, 2) : ""}</span>
        </button>;
      })}
    </div>
    <table className={styles.srOnly}><caption>{caption}</caption><tbody>{days.map((day) => <tr key={day.date.toISOString()}><th scope="row">{fullDay.format(day.date)}</th><td>{day.count}</td></tr>)}</tbody></table>
  </section>;
}
