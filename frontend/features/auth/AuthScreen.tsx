"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactNode } from "react";
import { clearDevSession } from "@/frontend/shared/api/client";
import { dataCache } from "@/frontend/shared/api/data-cache";
import { userScope } from "@/shared/domain/live-updates";
import { registrationServerField, validateAuthForm } from "@/frontend/shared/lib/auth-validation";
import type { AuthMode, AuthValues, AuthFieldName, AuthErrors } from "@/frontend/shared/lib/auth-validation";
import type { AuthUser } from "@/shared/domain/types";
import styles from "./AuthScreen.module.css";
import { EmailConfirmation, emailConfirmationSnapshot, rememberEmailConfirmation, restoreEmailConfirmation, subscribeEmailConfirmation } from "./EmailConfirmation";
import { AuthField } from "./AuthField";
import { AuthLayout } from "./AuthLayout";
import { PASSWORD_HINT } from "@/shared/domain/password-policy";
import { PasswordRecovery, passwordRecoverySnapshot, rememberPasswordRecovery, restorePasswordRecovery, subscribePasswordRecovery } from "./PasswordRecovery";

export function AuthScreen({ onAuthenticated, initialMode = "login" }: { onAuthenticated: (user: AuthUser) => void; initialMode?: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [values, setValues] = useState<AuthValues>({ firstName: "", lastName: "", email: "", password: "", passwordConfirmation: "" });
  const [touched, setTouched] = useState<Set<AuthFieldName>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<AuthErrors>({});
  const [error, setError] = useState("");
  const [credentialsInvalid, setCredentialsInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState("");
  const recoverySnapshot = useSyncExternalStore(subscribePasswordRecovery, passwordRecoverySnapshot, () => "");
  const recovery = restorePasswordRecovery(recoverySnapshot);
  const confirmationSnapshot = useSyncExternalStore(subscribeEmailConfirmation, emailConfirmationSnapshot, () => "");
  const confirmation = restoreEmailConfirmation(confirmationSnapshot);
  const formRef = useRef<HTMLFormElement>(null);
  const validation = validateAuthForm(mode, values);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);
  function finishAuthentication(body: { user: AuthUser; session?: string; devAuthMode?: boolean }) {
    rememberEmailConfirmation(null);
    rememberPasswordRecovery(null);
    if (body.devAuthMode === true && typeof body.session === "string") window.sessionStorage.setItem("incruises_dev_session", body.session);
    else clearDevSession();
    dataCache.activate(userScope(body.user));
    onAuthenticated(body.user);
  }
  function focusField(field: AuthFieldName) { formRef.current?.querySelector<HTMLInputElement>(`[name="${field}"]`)?.focus(); }
  function change(field: AuthFieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => ({ ...current, [field]: undefined }));
    setError(""); setCredentialsInvalid(false); setSuccess("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setAttempted(true); setError(""); setServerErrors({}); setCredentialsInvalid(false);
    const invalid = Object.keys(validation)[0] as AuthFieldName | undefined;
    if (invalid) { focusField(invalid); return; }
    setPending(true);
    try {
      const inviteToken = new URLSearchParams(window.location.search).get("invite") || undefined;
      const payload = mode === "login"
        ? { email: values.email.trim(), password: values.password }
        : { ...values, firstName: values.firstName.trim(), lastName: values.lastName.trim(), email: values.email.trim(), inviteToken };
      const response = await fetch("/api/auth/" + mode, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof body.message === "string" ? body.message : "Сервис временно недоступен. Попробуйте позже.";
        const field = mode === "register" ? registrationServerField(message) : undefined;
        if (field) { setServerErrors({ [field]: message }); window.setTimeout(() => focusField(field), 0); }
        else { setError(message); setCredentialsInvalid(mode === "login" && response.status === 401); }
        return;
      }
      if (body.verificationRequired === true && typeof body.email === "string") {
        const next = { email: body.email, resendAt: Date.now() + Math.max(0, Number(body.resendAfter) || 0) * 1000 };
        rememberEmailConfirmation(next);
        setValues((current) => ({ ...current, password: "", passwordConfirmation: "" }));
        return;
      }
      if (!body.user || typeof body.user.id !== "string") { setError("Не удалось завершить вход. Попробуйте ещё раз."); return; }
      finishAuthentication(body);
    } catch {
      setError("Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.");
    } finally { setPending(false); }
  }
  function switchMode(next: AuthMode) {
    if (pending) return;
    setMode(next); setTouched(new Set()); setAttempted(false); setServerErrors({}); setError(""); setCredentialsInvalid(false); setSuccess("");
  }
  function field(name: AuthFieldName, label: string, autocomplete: string, placeholder: string, type = "text", action?: ReactNode) {
    const message = serverErrors[name] || ((attempted || touched.has(name)) ? validation[name] : undefined);
    const credentialError = credentialsInvalid && (name === "email" || name === "password");
    return <AuthField key={name} name={name} label={label} value={values[name]} type={type} autoComplete={autocomplete} placeholder={placeholder} action={action}
      hint={mode === "register" && name === "password" ? PASSWORD_HINT : undefined}
      error={message} credentialError={credentialError} onChange={(value) => change(name, value)}
      onBlur={() => setTouched((current) => new Set(current).add(name))} />;
  }
  function returnFromRecovery(email: string, done = false) {
    rememberPasswordRecovery(null); rememberEmailConfirmation(null);
    setValues((current) => ({ ...current, email, password: "", passwordConfirmation: "" }));
    switchMode("login");
    if (done) { clearDevSession(); setSuccess("Пароль изменён. Войдите с новым паролем."); }
  }
  if (recovery) return <PasswordRecovery initial={recovery} onBack={(email) => returnFromRecovery(email)} onDone={(email) => returnFromRecovery(email, true)} />;
  if (confirmation) return <EmailConfirmation initial={confirmation} onAuthenticated={finishAuthentication} onBack={() => {
    rememberEmailConfirmation(null); setValues((current) => ({ ...current, email: confirmation.email }));
    setAttempted(false); setError("");
  }} />;
  return <AuthLayout>
      <h1 className={styles.heading}>{mode === "login" ? "Войти в аккаунт" : "Создать аккаунт"}</h1>
      <p className={styles.intro}>{mode === "login" ? "С возвращением! Продолжайте выполнять задания и расти вместе с командой." : "Присоединяйтесь к команде: выполняйте задания, получайте обратную связь и следите за своим прогрессом."}</p>
      <form ref={formRef} className={styles.form} noValidate onSubmit={submit} aria-busy={pending}>
        <div className={styles.tabs} role="group" aria-label="Вход или регистрация"><button type="button" disabled={pending} className={mode === "login" ? styles.activeTab : ""} aria-pressed={mode === "login"} onClick={() => switchMode("login")}>Войти</button><button type="button" disabled={pending} className={mode === "register" ? styles.activeTab : ""} aria-pressed={mode === "register"} onClick={() => switchMode("register")}>Регистрация</button></div>
        <fieldset className={styles.fields} disabled={pending}>
          {mode === "register" && <div className={styles.names}>{field("firstName", "Имя", "given-name", "Имя")}{field("lastName", "Фамилия", "family-name", "Фамилия")}</div>}
          {field("email", "Email", "email", "name@example.com", "email")}
          {field("password", "Пароль", mode === "login" ? "current-password" : "new-password", mode === "register" ? "Придумайте пароль" : "Ваш пароль", "password", mode === "login" &&
            <button type="button" className={styles.forgotAction} disabled={pending} onClick={() => {
              setValues((current) => ({ ...current, password: "", passwordConfirmation: "" }));
              rememberPasswordRecovery({ step: "email", email: values.email.trim().slice(0, 254), resendAt: 0, expiresAt: Date.now() + 600_000 });
            }}>Забыли пароль?</button>)}
          {mode === "register" && field("passwordConfirmation", "Повторите пароль", "new-password", "Повторите пароль", "password")}
        </fieldset>
        {error && <div className={styles.notice} role="alert" id="auth-request-error"><span aria-hidden="true">!</span><div><strong>{mode === "login" ? "Не удалось войти" : "Не удалось зарегистрироваться"}</strong><p>{error}</p></div></div>}
        {success && <p className={styles.successNotice} role="status">{success}</p>}
        <button type="submit" className={styles.submit} disabled={pending}>{pending ? "Проверяем..." : mode === "login" ? "Войти" : "Создать аккаунт"}</button>
        <p className={styles.registerPrompt}>{mode === "login" ? "Нет аккаунта?" : "Уже есть аккаунт?"} <button type="button" disabled={pending} onClick={() => switchMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Зарегистрируйтесь" : "Войти"}</button></p>
      </form>
  </AuthLayout>;
}
