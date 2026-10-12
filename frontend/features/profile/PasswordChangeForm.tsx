"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PasswordChecklist } from "@/frontend/features/auth/AuthExtras";
import { changePassword } from "@/frontend/shared/api/profile-client";
import { validateNewPassword } from "@/shared/domain/password-policy";
import styles from "./ProfileEditor.module.css";

/** Current password, a new one twice; on success other devices have to sign in again. */
export function PasswordChangeForm({ onDone, onCancel, onDirtyChange }: { onDone: () => void; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = Boolean(current || next || repeat);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!current) { setError("Введите текущий пароль."); return; }
    const problem = validateNewPassword(next);
    if (problem) { setError(problem); return; }
    if (next !== repeat) { setError("Новый пароль и повтор не совпадают."); return; }
    if (next === current) { setError("Новый пароль совпадает с текущим. Придумайте другой."); return; }
    setBusy(true); setError("");
    try { await changePassword(current, next); setCurrent(""); setNext(""); setRepeat(""); onDone(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сменить пароль."); }
    finally { setBusy(false); }
  }

  const type = show ? "text" : "password";
  return <form className={styles.password} onSubmit={(event) => void submit(event)} aria-busy={busy}>
    <label htmlFor="password-current">Текущий пароль<input id="password-current" type={type} autoComplete="current-password" value={current} disabled={busy} onChange={(event) => setCurrent(event.target.value)} /></label>
    <label htmlFor="password-new">Новый пароль<input id="password-new" type={type} autoComplete="new-password" value={next} disabled={busy} aria-describedby="password-new-rules" onChange={(event) => setNext(event.target.value)} /></label>
    <PasswordChecklist password={next} id="password-new-rules" />
    <label htmlFor="password-repeat">Повторите новый пароль<input id="password-repeat" type={type} autoComplete="new-password" value={repeat} disabled={busy} onChange={(event) => setRepeat(event.target.value)} /></label>
    {repeat && next !== repeat && <p className={styles.hint}>Пароли пока не совпадают.</p>}
    <label className={styles.showPassword}><input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} />Показать пароли</label>
    <p className={styles.hint}>После смены пароля на других телефонах и компьютерах нужно будет войти заново. Здесь вы останетесь в аккаунте.</p>
    {error && <div className={styles.error} role="alert"><p>{error}</p></div>}
    <div className={styles.formActions}>
      <button type="submit" className="button button-primary" disabled={busy || !current || !next || !repeat}>{busy ? "Меняем пароль…" : "Сменить пароль"}</button>
      <button type="button" className="button button-edit" disabled={busy} onClick={onCancel}>Отмена</button>
    </div>
  </form>;
}
