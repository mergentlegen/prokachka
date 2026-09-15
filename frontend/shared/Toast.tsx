"use client";

import styles from "./Toast.module.css";

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className={styles.toast}>
    <span className={styles.icon} aria-hidden="true">i</span>
    <p role="status" aria-live="polite">{message}</p>
    <button type="button" onClick={onClose} aria-label="Закрыть уведомление">×</button>
  </div>;
}
