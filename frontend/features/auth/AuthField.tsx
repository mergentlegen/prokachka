"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import styles from "./AuthScreen.module.css";

export function AuthField({ name, label, value, type, autoComplete, placeholder, error, credentialError = false, action, hint, onChange, onBlur }: {
  name: string; label: string; value: string; type: string; autoComplete: string; placeholder: string;
  error?: string; credentialError?: boolean; action?: ReactNode; hint?: string; onChange: (value: string) => void; onBlur?: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const invalid = Boolean(error) || credentialError;
  const id = `auth-${name}`;
  return <div className={styles.field}>
    <div className={styles.fieldHeading}><label htmlFor={id}>{label}</label>{action}</div>
    <div className={`${styles.input} ${invalid ? styles.invalid : ""}`}>
      <input id={id} name={name} type={type === "password" && revealed ? "text" : type} value={value} required autoComplete={autoComplete}
        autoCapitalize={type === "email" ? "none" : undefined} spellCheck={type === "email" ? false : undefined}
        aria-invalid={invalid} aria-describedby={[hint && `${id}-hint`, error ? `${id}-error` : credentialError ? "auth-request-error" : ""].filter(Boolean).join(" ") || undefined}
        placeholder={placeholder} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
      {type === "password" && <button type="button" className={styles.reveal} aria-label={revealed ? "Скрыть пароль" : "Показать пароль"} aria-pressed={revealed} onClick={() => setRevealed((current) => !current)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{revealed && <path d="m3 3 18 18" />}</svg>
      </button>}
    </div>
    {hint && <p id={`${id}-hint`} className={styles.codeHint}>{hint}</p>}
    {error && <p id={`${id}-error`} className={styles.fieldError} role="alert">{error}</p>}
  </div>;
}
