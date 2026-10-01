"use client";

import type { ReactNode } from "react";
import type { MemberTab } from "./use-member-data";
import styles from "./MemberNav.module.css";

export type MemberNavTab = Exclude<MemberTab, "profile">;

const icon = (path: ReactNode) => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;

export const memberNavIcons: Record<MemberNavTab, ReactNode> = {
  home: icon(<><path d="M4 10.5 12 4l8 6.5" /><path d="M6 9v10h4.5v-5h3v5H18V9" /></>),
  tasks: icon(<><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4.5V3h6v1.5" /><path d="m8.5 11 1.6 1.6 3-3" /><path d="M8.5 16.5h7" /></>),
  feedback: icon(<><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" /><path d="M8 10h8M8 13h5" /></>),
  ranking: icon(<><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5" /><path d="M12 13v3.5M8.5 20h7M10 16.5h4V20h-4z" /></>),
  network: icon(<><circle cx="12" cy="6" r="2.5" /><circle cx="5.5" cy="17.5" r="2.5" /><circle cx="18.5" cy="17.5" r="2.5" /><path d="M12 8.5v3M12 11.5l-5 4M12 11.5l5 4" /></>),
};

export const memberNavItems: Array<[MemberNavTab, string, string]> = [
  ["home", "Обзор", "Обзор"], ["tasks", "Задания", "Задания"], ["feedback", "Обратная связь", "Отклик"], ["ranking", "Рейтинг", "Рейтинг"], ["network", "Моя сеть", "Сеть"],
];

export function MemberBottomNav({ tab, onChange, feedbackUnread }: { tab: MemberTab; onChange: (tab: MemberNavTab) => void; feedbackUnread: number }) {
  return <nav className={`bottom-nav ${styles.nav}`} aria-label="Основная навигация">
    {memberNavItems.map(([id, , label]) => <button type="button" key={id} className={tab === id ? `active ${styles.active}` : ""} aria-current={tab === id ? "page" : undefined} onClick={() => onChange(id)}>
      <span className={styles.icon}>{memberNavIcons[id]}{id === "feedback" && feedbackUnread > 0 && <b className={styles.badge} aria-label={`Непрочитанных: ${feedbackUnread}`}>{feedbackUnread > 9 ? "9+" : feedbackUnread}</b>}</span>
      <span className="bottom-nav-label">{label}</span>
    </button>)}
  </nav>;
}
