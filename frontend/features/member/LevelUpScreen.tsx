"use client";

import { useEffect, useRef } from "react";
import { levelUpMessage } from "@/shared/domain/levels";
import styles from "./LevelUpScreen.module.css";

/** Shown once after moving up a level: who the participant is now, and their team. */
export function LevelUpScreen({ level, onTeam, onClose }: { level: number; onTeam: () => void; onClose: () => void }) {
  const message = levelUpMessage(level);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus({ preventScroll: true }); }, []);
  return <div className={styles.screen} role="dialog" aria-modal="true" aria-labelledby="level-up-title" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть">×</button>
    <div className={styles.rays} aria-hidden="true" />
    <section className={styles.content}>
      <p className={styles.badge}><span aria-hidden="true">★</span>Уровень {level}</p>
      <p className={styles.course}>Звёздный курс пройден: 100 миль и 10 звёзд</p>
      <h2 id="level-up-title">{message.title}</h2>
      <p className={styles.text}>{message.text}</p>
      <button ref={button} type="button" className={styles.team} onClick={onTeam}>{message.action}</button>
      <p className={styles.next}>Открылись задания и рейтинг уровня {level}. Прошлые задания — в архиве, их можно пересмотреть.</p>
    </section>
  </div>;
}
