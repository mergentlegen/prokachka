"use client";

import { useRef, useState, type ReactNode } from "react";
import styles from "./FileDropZone.module.css";

// A tap-or-drop area instead of the browser's grey "Choose file" control.
export function FileDropZone({ accept, multiple = true, disabled = false, title, hint, icon, onFiles }: {
  accept: string; multiple?: boolean; disabled?: boolean; title: ReactNode; hint?: ReactNode; icon?: ReactNode; onFiles: (files: FileList) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return <label className={`drop-zone ${styles.zone} ${over ? styles.over : ""} ${disabled ? styles.disabled : ""}`}
    onDragOver={(event) => { if (disabled) return; event.preventDefault(); setOver(true); }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => { event.preventDefault(); setOver(false); if (!disabled && event.dataTransfer.files.length) onFiles(event.dataTransfer.files); }}>
    {/* Inline styles keep the native control hidden even under broad form-field rules. */}
    <input ref={input} type="file" accept={accept} multiple={multiple} disabled={disabled}
      style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", border: 0, opacity: 0 }}
      onChange={(event) => { if (event.currentTarget.files?.length) onFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <span className={styles.icon} aria-hidden="true">{icon || <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>}</span>
    <span className={styles.copy}><strong>{title}</strong>{hint && <small>{hint}</small>}</span>
  </label>;
}
