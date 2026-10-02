"use client";

import { PASSWORD_RULES } from "@/shared/domain/password-policy";
import styles from "./AuthScreen.module.css";

export type InvitationPreview = { token: string; status: "ok"; inviterName: string; teamName: string } | { token: string; status: "invalid"; message: string } | { token: string; status: "unchecked" };

const steps = ["Аккаунт", "Почта", "Команда"];

/** Where the newcomer is in sign-up: account → e-mail code → team. */
export function AuthSteps({ current }: { current: 1 | 2 | 3 }) {
  return <ol className={styles.steps} aria-label={`Шаг ${current} из ${steps.length}`}>
    {steps.map((label, index) => {
      const step = index + 1;
      const state = step < current ? styles.stepDone : step === current ? styles.stepNow : "";
      return <li key={label} className={state} aria-current={step === current ? "step" : undefined}><b aria-hidden="true">{step < current ? "✓" : step}</b>{label}</li>;
    })}
  </ol>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

/** Who invites the visitor, or why the link no longer works. */
export function InviteCard({ invitation }: { invitation: InvitationPreview | "loading" }) {
  if (invitation === "loading") return <div className={`${styles.invite} ${styles.inviteLoading}`} aria-busy="true"><span className={styles.inviteAvatar} aria-hidden="true" /><p>Проверяем приглашение…</p></div>;
  if (invitation.status === "unchecked") return null;
  if (invitation.status === "invalid") return <div className={`${styles.invite} ${styles.inviteInvalid}`} role="status">
    <span className={styles.inviteAvatar} aria-hidden="true">!</span>
    <div><strong>Приглашение не действует</strong><p>{invitation.message} Вы всё равно можете зарегистрироваться и выбрать команду после входа.</p></div>
  </div>;
  return <div className={styles.invite}>
    <span className={styles.inviteAvatar} aria-hidden="true">{initials(invitation.inviterName)}</span>
    <div><small>Вас приглашает</small><strong>{invitation.inviterName}</strong><p>в команду «{invitation.teamName}»</p></div>
  </div>;
}

/** Requirements light up as the password is typed; the same rules the server checks. */
export function PasswordChecklist({ password, id }: { password: string; id: string }) {
  return <ul id={id} className={styles.checklist} aria-label="Требования к паролю">
    {PASSWORD_RULES.map((rule) => {
      const met = rule.test(password);
      return <li key={rule.id} className={met ? styles.met : ""}><b aria-hidden="true">{met ? "✓" : ""}</b>{rule.label}<span className={styles.srOnly}>{met ? " — выполнено" : " — ещё нет"}</span></li>;
    })}
  </ul>;
}
