"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AuthUser } from "@/shared/domain/types";
import Image from "next/image";
import styles from "./AuthScreen.module.css";

export type PendingEmailConfirmation = { email: string; resendAt: number };
const storageKey = "prokachka-pending-email";
const changedEvent = "prokachka:pending-email";
let fallbackSnapshot = "";

export function rememberEmailConfirmation(value: PendingEmailConfirmation | null) {
  fallbackSnapshot = value ? JSON.stringify({ ...value, expiresAt: Date.now() + 24 * 60 * 60_000 }) : "";
  try {
    if (value) window.sessionStorage.setItem(storageKey, fallbackSnapshot);
    else window.sessionStorage.removeItem(storageKey);
  } catch { /* Private browsing can disable storage; verification still works. */ }
  window.dispatchEvent(new Event(changedEvent));
}

export function emailConfirmationSnapshot() {
  try { return window.sessionStorage.getItem(storageKey) || ""; }
  catch { return fallbackSnapshot; }
}

export function subscribeEmailConfirmation(callback: () => void) {
  window.addEventListener(changedEvent, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(changedEvent, callback); window.removeEventListener("storage", callback); };
}

export function restoreEmailConfirmation(snapshot: string): PendingEmailConfirmation | null {
  try {
    const value = JSON.parse(snapshot || "null");
    if (value && typeof value.email === "string" && value.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
      && Number.isFinite(value.resendAt) && value.expiresAt > Date.now()) return { email: value.email, resendAt: value.resendAt };
  } catch { /* Ignore stale or malformed local state. */ }
  return null;
}

export function EmailConfirmation({ initial, onBack, onAuthenticated }: {
  initial: PendingEmailConfirmation;
  onBack: () => void;
  onAuthenticated: (body: { user: AuthUser; session?: string; devAuthMode?: boolean }) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<"verify" | "resend" | null>(null);
  const [resendAt, setResendAt] = useState(initial.resendAt);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const seconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    inputRef.current?.focus();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function send(action: "verify" | "resend") {
    if (pending || (action === "resend" && seconds > 0)) return;
    setError(""); setNotice("");
    if (action === "verify" && !/^\d{6}$/.test(code)) {
      setError("Введите шестизначный код из письма."); inputRef.current?.focus(); return;
    }
    setPending(action);
    try {
      const response = await fetch(`/api/auth/${action === "verify" ? "verify-email" : "resend-email"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: initial.email, ...(action === "verify" ? { code } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body.message === "string" ? body.message : "Сервис временно недоступен. Попробуйте позже.");
        if (action === "resend" && response.status === 429) {
          const wait = Math.min(3600, Math.max(1, Number(response.headers.get("Retry-After")) || 60));
          const next = Date.now() + wait * 1000;
          setResendAt(next); rememberEmailConfirmation({ email: initial.email, resendAt: next });
        }
        return;
      }
      if (action === "resend") {
        const next = Date.now() + 60_000;
        setResendAt(next); setNow(Date.now()); setCode("");
        rememberEmailConfirmation({ email: initial.email, resendAt: next });
        setNotice("Новый код отправлен. Используйте код из последнего письма.");
        inputRef.current?.focus();
      } else if (body.user && typeof body.user.id === "string") {
        rememberEmailConfirmation(null); onAuthenticated(body);
      } else setError("Не удалось завершить регистрацию. Попробуйте войти по почте и паролю.");
    } catch { setError("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз."); }
    finally { setPending(null); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send("verify"); }

  return <main className={`login-shell ${styles.screen}`}>
    <div className="login-decor decor-one" aria-hidden="true" /><div className="login-decor decor-two" aria-hidden="true" />
    <div className={`login-panel ${styles.panel}`}>
      <div className={`login-brand ${styles.brand}`}><Image className="brand-logo" src="/brand/logo-light.svg" alt="Прокачка" width={180} height={52} unoptimized /></div>
      <div className={styles.mailIcon} aria-hidden="true">✉</div>
      <h1 className={styles.heading}>Подтвердите почту</h1>
      <p className={styles.intro}>Введите код из письма на <strong className={styles.emailAddress}>{initial.email}</strong>. Если письмо не пришло, проверьте папку «Спам».</p>
      <form className={styles.form} onSubmit={submit} noValidate aria-busy={Boolean(pending)}>
        <div className={styles.field}>
          <label htmlFor="email-confirmation-code">Код из письма</label>
          <div className={`${styles.input} ${error ? styles.invalid : ""}`}>
            <input ref={inputRef} id="email-confirmation-code" className={styles.codeInput} name="code" type="text"
              inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
              value={code} placeholder="000000" disabled={Boolean(pending)} required spellCheck={false}
              aria-invalid={Boolean(error)} aria-describedby={error ? "email-code-error" : "email-code-hint"}
              onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }} />
          </div>
          <p id="email-code-hint" className={styles.codeHint}>6 цифр. Код действует 10 минут.</p>
        </div>
        {error && <div id="email-code-error" className={styles.notice} role="alert"><p>{error}</p></div>}
        {notice && <p className={styles.successNotice} role="status">{notice}</p>}
        <button type="submit" className={`primary-button login-button ${styles.submit}`} disabled={Boolean(pending)}>{pending === "verify" ? "Подтверждаем…" : "Подтвердить почту"}</button>
        <button type="button" className={styles.secondaryAction} disabled={Boolean(pending) || seconds > 0} onClick={() => void send("resend")}>
          {pending === "resend" ? "Отправляем…" : seconds > 0 ? `Отправить код повторно через ${seconds} с` : "Отправить код повторно"}
        </button>
        <button type="button" className={styles.backAction} disabled={Boolean(pending)} onClick={onBack}>Изменить почту или вернуться ко входу</button>
      </form>
    </div>
  </main>;
}
