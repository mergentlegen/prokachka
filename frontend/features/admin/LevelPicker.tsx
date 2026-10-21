"use client";

import { LEVELS, levelTitle } from "@/shared/domain/levels";
import styles from "./LevelPicker.module.css";

/** «Для кого»: the level whose participants get the task or program. */
export function LevelPicker({ value, onChange, disabled = false }: { value: number; onChange: (level: number) => void; disabled?: boolean }) {
  return <fieldset className={styles.picker} disabled={disabled}>
    <legend>Для кого</legend>
    <div className={styles.options}>
      {LEVELS.map((level) => <label key={level} className={value === level ? styles.on : ""}>
        <input type="radio" name="publication-level" value={level} checked={value === level} onChange={() => onChange(level)} />
        <b>Уровень {level}</b><small>{level === 3 ? "следующий уровень" : levelTitle(level) === "Капитан" ? "капитаны" : "игроки"}</small>
      </label>)}
    </div>
  </fieldset>;
}
