"use client";

import { useEffect, useState } from "react";
import type { AuthUser } from "@/shared/domain/types";
import { Avatar } from "@/frontend/shared/Avatar";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import { loadProfileExtras, type ProfileExtras } from "@/frontend/shared/api/profile-client";
import { formatPhone } from "@/shared/domain/phone";
import { ProfileEditor } from "./ProfileEditor";
import { PasswordChangeForm } from "./PasswordChangeForm";
import { TelegramConnect } from "@/frontend/features/telegram/TelegramConnect";
import { plural } from "@/frontend/shared/lib/plural";
import styles from "./ProfileEditor.module.css";

type Mode = "view" | "edit" | "password";

/** What the mentor sees about their work: branch size, works waiting, and whether Telegram notifications reach them. */
export type MentorSummary = {
  pending: number; onOpenReview: () => void;
  telegramBusy: boolean; onLinkTelegram: () => void; onRefreshTelegram: () => void | Promise<void>; onUnlinkTelegram: () => void | Promise<void>;
};

export function ProfileDialog({ user, onSaved, onClose, onNotice, mentor }: { user: AuthUser; onSaved: (user: AuthUser) => void; onClose: () => void; onNotice?: (message: string) => void; mentor?: MentorSummary }) {
  const [mode, setMode] = useState<Mode>("view");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const [extras, setExtras] = useState<ProfileExtras | null>(null);
  const [extrasKey, setExtrasKey] = useState(0);

  useEffect(() => {
    let active = true;
    void loadProfileExtras().then((loaded) => { if (active) setExtras(loaded); }).catch(() => { if (active) setExtras({}); });
    return () => { active = false; };
  }, [extrasKey]);

  function guard(action: () => void) { if (dirty) setLeave(() => action); else action(); }
  const back = () => guard(() => { setDirty(false); setMode("view"); });
  const title = mode === "edit" ? "Редактировать профиль" : mode === "password" ? "Смена пароля" : "Мой профиль";

  return <><ModalSheet title={title} onClose={() => { if (!busy) guard(onClose); }}>
    {mode === "edit" && (extras === null ? <p className={styles.hint}>Загружаем профиль…</p>
      : <ProfileEditor user={user} phone={extras.phone} onBusyChange={setBusy} onDirtyChange={setDirty} onCancel={back}
        onSaved={(updated) => { setDirty(false); onSaved(updated); setExtrasKey((key) => key + 1); setMode("view"); }} />)}
    {mode === "password" && <PasswordChangeForm onDirtyChange={setDirty} onCancel={back} onDone={() => { setDirty(false); setMode("view"); onNotice?.("Пароль изменён. На других устройствах нужно будет войти заново."); }} />}
    {mode === "view" && <div className={styles.overview}>
      <div className={styles.identity}><Avatar name={user.name} src={user.avatarUrl} className={styles.previewAvatar} eager /><div>
        <h2>{user.name}</h2>
        <p>{user.role === "admin" ? "Руководитель команды" : "Наставник"}{extras?.teamName ? ` · «${extras.teamName}»` : ""}</p>
        {extras?.phone && <p>📱 {formatPhone(extras.phone)}</p>}
      </div></div>
      {mentor && <section className={styles.summary} aria-label="Моя работа наставника">
        <div><strong>{extras?.branchSize ?? "…"}</strong><span>{user.role === "admin" ? plural(extras?.branchSize ?? 0, "участник в команде", "участника в команде", "участников в команде") : plural(extras?.branchSize ?? 0, "человек в ветке", "человека в ветке", "человек в ветке")}</span></div>
        <button type="button" onClick={mentor.onOpenReview}><strong>{mentor.pending}</strong><span>{plural(mentor.pending, "работа ждёт", "работы ждут", "работ ждут")} проверки →</span></button>
      </section>}
      {mentor && <>
        {!user.telegramId && <p className={styles.telegramWarning}>⚠️ Telegram не привязан — уведомления о новых работах и сообщениях не приходят.</p>}
        <TelegramConnect telegramId={user.telegramId} busy={mentor.telegramBusy} onLink={mentor.onLinkTelegram} onRefresh={mentor.onRefreshTelegram} onUnlink={mentor.onUnlinkTelegram} />
      </>}
      {user.login && <div className={styles.accountInfo}><span>{user.login.includes("@") ? "Почта аккаунта" : "Логин аккаунта"}</span><strong>{user.login}</strong></div>}
      <button type="button" className={`button button-edit ${styles.editButton}`} onClick={() => setMode("edit")}>Редактировать профиль</button>
      <button type="button" className={`button button-edit ${styles.editButton}`} onClick={() => setMode("password")}>Сменить пароль</button>
    </div>}
  </ModalSheet>
    {leave && <ConfirmModal title="Выйти без сохранения?" eyebrow="Изменения не сохранены" description="Введённые изменения пропадут. Чтобы их сохранить, вернитесь и нажмите кнопку сохранения."
      confirmLabel="Выйти без сохранения" cancelLabel="Продолжить редактирование" onClose={() => setLeave(null)}
      onConfirm={() => { const action = leave; setLeave(null); setDirty(false); action(); }} />}
  </>;
}
