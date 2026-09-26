"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Image from "next/image";
import { AuthField } from "./AuthField";
import styles from "./AuthScreen.module.css";

export type RecoveryState = { step: "email" | "code" | "password"; email: string; resendAt: number; expiresAt: number };
const storageKey = "prokachka-password-recovery";
const changedEvent = "prokachka:password-recovery";
let fallback = "";
export function rememberPasswordRecovery(value: RecoveryState | null) {
  fallback = value ? JSON.stringify(value) : "";
  try {
    if (value) window.sessionStorage.setItem(storageKey, fallback);
    else window.sessionStorage.removeItem(storageKey);
  } catch { /* Recovery remains usable when storage is unavailable. */ }
  window.dispatchEvent(new Event(changedEvent));
}
export function passwordRecoverySnapshot() {
  try { return window.sessionStorage.getItem(storageKey) || ""; } catch { return fallback; }
}
export function subscribePasswordRecovery(callback: () => void) {
  window.addEventListener(changedEvent, callback); window.addEventListener("storage", callback);
  return () => { window.removeEventListener(changedEvent, callback); window.removeEventListener("storage", callback); };
}
export function restorePasswordRecovery(snapshot: string): RecoveryState | null {
  try {
    const state = JSON.parse(snapshot || "null");
    if (!state || !["email", "code", "password"].includes(state.step) || typeof state.email !== "string" || state.email.length > 254
      || !Number.isFinite(state.resendAt) || !Number.isFinite(state.expiresAt) || state.expiresAt <= Date.now()
      || (state.step !== "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email))) return null;
    // Only non-secret navigation state is restored from browser storage.
    return { step: state.step, email: state.email, resendAt: state.resendAt, expiresAt: state.expiresAt };
  } catch { return null; }
}

export function PasswordRecovery({ initial, onBack, onDone }: {
  initial: RecoveryState; onBack: (email: string) => void; onDone: (email: string) => void;
}) {
  const [state, setState] = useState(initial);
  const [email, setEmail] = useState(initial.email);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const formRef = useRef<HTMLFormElement>(null);
  const seconds = Math.max(0, Math.ceil((state.resendAt - now) / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { formRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }, [state.step]);
  function move(next: RecoveryState) { setState(next); rememberPasswordRecovery(next); }
  function edit(field: string, value: string) {
    setErrors((current) => ({ ...current, [field]: "" })); setError("");
    if (field === "email") setEmail(value);
    else if (field === "code") setCode(value.replace(/\D/g, "").slice(0, 6));
    else if (field === "password") setPassword(value);
    else setConfirmation(value);
  }
  async function send(action: "request" | "verify" | "reset") {
    if (pending || (action === "request" && seconds > 0)) return;
    setError(""); setNotice("");
    const invalid: Record<string, string> = {};
    if (action === "request" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254)) invalid.email = "Введите корректный email.";
    if (action === "verify" && !/^\d{6}$/.test(code)) invalid.code = "Введите шестизначный код из письма.";
    if (action === "reset") {
      if (password.length < 6 || password.length > 1024) invalid.password = "Пароль должен содержать от 6 до 1024 символов.";
      if (!confirmation || password !== confirmation) invalid.passwordConfirmation = "Пароли не совпадают.";
    }
    setErrors(invalid);
    const field = Object.keys(invalid)[0];
    if (field) { formRef.current?.querySelector<HTMLInputElement>(`[name="${field}"]`)?.focus(); return; }
    setPending(true);
    try {
      const payload = action === "reset" ? { password, passwordConfirmation: confirmation }
        : { email: (action === "request" ? email : state.email).trim().toLowerCase(), ...(action === "verify" ? { code } : {}) };
      const response = await fetch(`/api/auth/password/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body.message === "string" ? body.message : "Сервис временно недоступен. Попробуйте позже.");
        if (response.status === 429 && action === "request") {
          const wait = Math.min(3600, Math.max(1, Number(response.headers.get("Retry-After")) || 60));
          move({ ...state, resendAt: Date.now() + wait * 1000 });
        }
        if (response.status === 410 && action === "reset") {
          setPassword(""); setConfirmation(""); setCode("");
          move({ ...state, step: "code", expiresAt: Date.now() + 10 * 60_000 });
        }
        return;
      }
      if (action === "request" && body.recoveryRequested === true) {
        const timestamp = Date.now();
        move({ step: "code", email: email.trim().toLowerCase(), resendAt: timestamp + 60_000, expiresAt: timestamp + 10 * 60_000 });
        setNow(timestamp); setCode("");
        if (state.step === "code") setNotice("Запрос отправлен. Используйте код из последнего письма.");
      } else if (action === "verify" && body.recoveryVerified === true) {
        setCode(""); move({ ...state, step: "password", expiresAt: Date.now() + 600_000 });
      } else if (action === "reset" && body.passwordReset === true) {
        setPassword(""); setConfirmation(""); onDone(state.email);
      } else setError("Не удалось завершить действие. Попробуйте ещё раз.");
    } catch { setError("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз."); }
    finally { setPending(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(state.step === "email" ? "request" : state.step === "code" ? "verify" : "reset"); }
  const title = state.step === "email" ? "Восстановить пароль" : state.step === "code" ? "Проверьте почту" : "Новый пароль";
  return <main className={`login-shell ${styles.screen}`}>
    <div className="login-decor decor-one" aria-hidden="true" /><div className="login-decor decor-two" aria-hidden="true" />
    <div className={`login-panel ${styles.panel}`}>
      <div className={`login-brand ${styles.brand}`}><Image className="brand-logo" src="/brand/logo-light.svg" alt="Прокачка" width={180} height={52} unoptimized /></div>
      <h1 className={styles.heading}>{title}</h1>
      <p className={styles.intro}>{state.step === "email" ? "Укажите почту вашего аккаунта. Мы отправим код для восстановления доступа."
        : state.step === "code" ? <>Если аккаунт <strong className={styles.emailAddress}>{state.email}</strong> существует, на эту почту отправлен код. Проверьте также папку «Спам».</>
        : "Придумайте новый пароль. После сохранения вы сможете войти с ним в свой аккаунт."}</p>
      <form ref={formRef} className={styles.form} onSubmit={submit} noValidate aria-busy={pending}>
        <fieldset className={styles.fields} disabled={pending}>
          {state.step === "email" && <AuthField name="email" label="Email" type="email" autoComplete="email" value={email} placeholder="name@example.com" error={errors.email} onChange={(value) => edit("email", value)} />}
          {state.step === "code" && <div className={styles.field}>
            <label htmlFor="password-recovery-code">Код из письма</label>
            <div className={`${styles.input} ${errors.code ? styles.invalid : ""}`}>
              <input id="password-recovery-code" name="code" className={styles.codeInput} type="text" inputMode="numeric" autoComplete="one-time-code"
                pattern="[0-9]{6}" maxLength={6} value={code} placeholder="000000" required spellCheck={false}
                aria-invalid={Boolean(errors.code)} aria-describedby={errors.code ? "recovery-code-error" : "recovery-code-hint"} onChange={(event) => edit("code", event.target.value)} />
            </div>
            <p id="recovery-code-hint" className={styles.codeHint}>6 цифр. Код действует 10 минут.</p>
            {errors.code && <p id="recovery-code-error" className={styles.fieldError} role="alert">{errors.code}</p>}
          </div>}
          {state.step === "password" && <>
            <AuthField name="password" label="Новый пароль" type="password" autoComplete="new-password" value={password} placeholder="Минимум 6 символов" error={errors.password} onChange={(value) => edit("password", value)} />
            <AuthField name="passwordConfirmation" label="Повторите новый пароль" type="password" autoComplete="new-password" value={confirmation} placeholder="Повторите пароль" error={errors.passwordConfirmation} onChange={(value) => edit("passwordConfirmation", value)} />
          </>}
        </fieldset>
        {error && <div className={styles.notice} role="alert"><p>{error}</p></div>}
        {notice && <p className={styles.successNotice} role="status">{notice}</p>}
        <button type="submit" className={`primary-button login-button ${styles.submit}`} disabled={pending || (state.step === "email" && seconds > 0)}>
          {pending ? "Подождите…" : state.step === "email" ? seconds > 0 ? `Отправить код через ${seconds} с` : "Отправить код" : state.step === "code" ? "Подтвердить код" : "Сохранить новый пароль"}
        </button>
        {state.step === "code" && <button type="button" className={styles.secondaryAction} disabled={pending || seconds > 0} onClick={() => void send("request")}>
          {seconds > 0 ? `Отправить код повторно через ${seconds} с` : "Отправить код повторно"}
        </button>}
        {state.step === "code" && <button type="button" className={styles.backAction} disabled={pending} onClick={() => {
          setCode(""); setError(""); setErrors({}); move({ ...state, step: "email", expiresAt: Date.now() + 600_000 });
        }}>Изменить email</button>}
        <button type="button" className={styles.backAction} disabled={pending} onClick={() => onBack(state.step === "email" ? email : state.email)}>Вернуться ко входу</button>
      </form>
    </div>
  </main>;
}
