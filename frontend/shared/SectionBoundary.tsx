"use client";
import type { ReactNode } from "react";
import styles from "./SectionBoundary.module.css";

export function SectionBoundary({ loading, error, onRetry, children }: {
  loading: boolean; error?: string; onRetry?: () => void; children: ReactNode;
}) {
  return <div className={styles.region} aria-busy={loading}>
    {loading ? <>
      <div className={styles.skeleton} aria-hidden="true" inert>
        <div className={styles.metrics}>{[0, 1, 2].map((id) => <div key={id}><i /><b /></div>)}</div>
        <div className={styles.panel}>{[0, 1, 2, 3].map((id) => <div className={styles.row} key={id}><i /><span /><b /></div>)}</div>
      </div>
      <div className={styles.overlay} role="status"><span className={styles.spinner} /><span>Загружаем раздел…</span></div>
    </> : children}
    {!loading && error && <div className={styles.error} role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Повторить</button></div>}
  </div>;
}
