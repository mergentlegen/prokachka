"use client";

import type { ReactNode } from "react";
import styles from "./MoreMenu.module.css";

type Destination = "network" | "reviews" | "profile";
type Entry = { key: string; title: string; hint: string; icon: ReactNode; tone: string; open?: Destination };

const icon = (path: ReactNode) => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;

// Everything the bottom menu has no room for. Sections still in the works are listed with «скоро».
const entries: Entry[] = [
  { key: "network", title: "Моя сеть", hint: "Кого вы пригласили в команду", tone: "blue", open: "network",
    icon: icon(<><circle cx="12" cy="6" r="2.5" /><circle cx="5.5" cy="17.5" r="2.5" /><circle cx="18.5" cy="17.5" r="2.5" /><path d="M12 8.5v3M12 11.5l-5 4M12 11.5l5 4" /></>) },
  { key: "profile", title: "Профиль", hint: "Данные, Telegram, пароль", tone: "green", open: "profile",
    icon: icon(<><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>) },
  { key: "reviews", title: "Отзывы", hint: "Что говорят участники команды", tone: "violet", open: "reviews",
    icon: icon(<><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" /><path d="m12 8.2.8 1.6 1.8.3-1.3 1.2.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.2 1.8-.3.8-1.6Z" /></>) },
  { key: "mentors", title: "Наставники", hint: "Кто ведёт команду и как связаться", tone: "gold",
    icon: icon(<><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><path d="m17.5 6 .9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3.9-1.8Z" /></>) },
];

export function MoreMenu({ onOpen }: { onOpen: (destination: Destination) => void }) {
  return <section className={styles.more} aria-labelledby="more-title">
    <div className="section-heading"><div><p className="eyebrow">Разделы</p><h2 id="more-title">Ещё</h2></div></div>
    <div className={styles.list}>
      {entries.map((entry) => {
        const body = <>
          <span className={`${styles.icon} ${styles[entry.tone]}`}>{entry.icon}</span>
          <span className={styles.text}><strong>{entry.title}</strong><small>{entry.hint}</small></span>
          {entry.open ? <span className={styles.arrow} aria-hidden="true">›</span> : <span className={styles.soon}>скоро</span>}
        </>;
        return entry.open
          ? <button type="button" key={entry.key} className={styles.item} onClick={() => onOpen(entry.open!)}>{body}</button>
          : <div key={entry.key} className={`${styles.item} ${styles.disabled}`} aria-disabled="true">{body}</div>;
      })}
    </div>
  </section>;
}
