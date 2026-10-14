"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthUser, Store, User } from "@/shared/domain/types";
import { Avatar } from "@/frontend/shared/Avatar";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import { SectionBoundary } from "@/frontend/shared/SectionBoundary";
import { ProfileEditor } from "@/frontend/features/profile/ProfileEditor";
import { PasswordChangeForm } from "@/frontend/features/profile/PasswordChangeForm";
import { TelegramConnect } from "@/frontend/features/telegram/TelegramConnect";
import { loadProfileExtras, type ProfileExtras } from "@/frontend/shared/api/profile-client";
import { QrCode } from "@/frontend/shared/QrCode";
import { STAR_AWARD_OPTIONS } from "@/shared/domain/star-awards";
import { formatDate, milesUnit } from "@/frontend/shared/lib/format";
import { formatPhone } from "@/shared/domain/phone";
import { plural } from "@/frontend/shared/lib/plural";
import styles from "./MemberProfile.module.css";

type Mode = "view" | "edit" | "password";

const joinedFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const cleanYear = (text: string) => text.replace(/\s*г\.$/, "");

const icon = (path: string) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
const statIcons = {
  miles: icon("M3 17l6-6 4 4 8-8M15 7h6v6"),
  rank: icon("M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"),
  done: icon("M20 6 9 17l-5-5"),
  stars: icon("m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"),
};

const starKind = (kind?: string) => STAR_AWARD_OPTIONS.find((option) => option.kind === kind)?.label;

export function MemberProfile({ loading, error, onRetry, user, store, rank, points, stars, telegramBusy, onLinkTelegram, onRefreshTelegram, inviteUrl, inviteBusy, onCreateInvite, onCopyInvite, onProfileSaved, onNotice, onOpenDone, onOpenRanking, onUnlinkTelegram, onClose, onLogout }: {
  loading?: boolean; error?: string; onRetry?: () => void; user: User; store: Store; rank: number; points: number; stars: number;
  telegramBusy: boolean; onLinkTelegram: () => void; onRefreshTelegram: () => void;
  inviteUrl: string; inviteBusy: boolean; onCreateInvite: () => void; onCopyInvite: (url: string) => void;
  onProfileSaved: (user: AuthUser) => void; onNotice: (message: string) => void;
  /** Opens the task list on what is already done. */
  onOpenDone: () => void;
  onOpenRanking: () => void; onUnlinkTelegram: () => void | Promise<void>;
  onClose: () => void; onLogout: () => void;
}) {
  const [mode, setMode] = useState<Mode>("view");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // What to do once the participant agrees to drop unsaved changes.
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const [extras, setExtras] = useState<ProfileExtras | null>(null);
  const [extrasKey, setExtrasKey] = useState(0);
  const [showQr, setShowQr] = useState(false);
  const starsRef = useRef<HTMLElement>(null);
  const reveal = (section: { current: HTMLElement | null }) => section.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  async function share() {
    if (!inviteUrl) return;
    try {
      if (navigator.share) await navigator.share({ title: "Приглашение в команду", text: "Присоединяйся к моей команде в Прокачке:", url: inviteUrl });
      else await onCopyInvite(inviteUrl);
    } catch (cause) { if (!(cause instanceof Error && cause.name === "AbortError")) void onCopyInvite(inviteUrl); }
  }

  useEffect(() => {
    let active = true;
    void loadProfileExtras().then((loaded) => { if (active) setExtras(loaded); }).catch(() => { if (active) setExtras({}); });
    return () => { active = false; };
  }, [extrasKey]);

  function guard(action: () => void) { if (dirty) setLeave(() => action); else action(); }
  const back = () => guard(() => { setDirty(false); setMode("view"); });
  const close = () => { if (!saving) guard(onClose); };

  const done = new Set(store.submissions.filter((item) => item.userId === user.id && item.status === "accepted" && item.interactiveCompleted !== false).map((item) => item.taskId)).size;
  const myStars = store.starAwards.filter((award) => award.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const title = mode === "edit" ? "Редактировать профиль" : mode === "password" ? "Смена пароля" : "Мой профиль";
  return <><ModalSheet title={title} onClose={close}>
    {mode === "edit" && extras !== null && <ProfileEditor user={user} phone={extras.phone} onBusyChange={setSaving} onDirtyChange={setDirty} onCancel={back}
      onSaved={(updated) => { setDirty(false); onProfileSaved(updated); setExtrasKey((key) => key + 1); setMode("view"); }} />}
    {mode === "edit" && extras === null && <p className={styles.loading}>Загружаем профиль…</p>}
    {mode === "password" && <PasswordChangeForm onDirtyChange={setDirty} onCancel={back} onDone={() => { setDirty(false); setMode("view"); onNotice("Пароль изменён. На других устройствах нужно будет войти заново."); }} />}

    {mode === "view" && <SectionBoundary loading={Boolean(loading)} error={error} onRetry={onRetry}><div className={styles.profile}>
      <section className={styles.hero}>
        <Avatar className={styles.avatar} name={user.name} src={user.avatarUrl} eager />
        <div className={styles.who}>
          <h2>{user.name}</h2>
          <p>{extras?.teamName ? <>Участник команды «{extras.teamName}»</> : "Участник команды"}</p>
          <ul className={styles.facts}>
            {user.teamJoinedAt && <li><span aria-hidden="true">📅</span>В команде с {cleanYear(joinedFormat.format(new Date(user.teamJoinedAt)))}</li>}
            {extras?.mentorName && <li><span aria-hidden="true">🧭</span>Наставник: {extras.mentorName}</li>}
            {extras?.phone
              ? <li><span aria-hidden="true">📱</span>{formatPhone(extras.phone)} <small>видят только наставники</small></li>
              : extras && <li><button type="button" className={styles.addPhone} onClick={() => setMode("edit")}>📱 Добавить номер телефона</button></li>}
          </ul>
        </div>
      </section>
      <button type="button" className={`button button-edit ${styles.edit}`} onClick={() => setMode("edit")}>Редактировать профиль</button>

      <div className={styles.stats}>
        <button type="button" className={styles.statMiles} onClick={onOpenRanking} aria-label={`${points} ${milesUnit(points)} — открыть рейтинг`}><i aria-hidden="true">{statIcons.miles}</i><strong>{points}</strong><span>{milesUnit(points)}</span></button>
        <button type="button" className={styles.statRank} onClick={onOpenRanking} aria-label={`Место ${rank || "—"} — открыть рейтинг`}><i aria-hidden="true">{statIcons.rank}</i><strong>{rank || "—"}</strong><span>место</span></button>
        <button type="button" className={styles.statDone} onClick={() => guard(onOpenDone)} aria-label={`Выполнено ${done} — открыть выполненные задания`}><i aria-hidden="true">{statIcons.done}</i><strong>{done}</strong><span>выполнено</span></button>
        <button type="button" className={styles.statStars} onClick={() => reveal(starsRef)} aria-label={`${stars} звёзд — за что`}><i aria-hidden="true">{statIcons.stars}</i><strong>{stars}</strong><span>{plural(stars, "звезда", "звезды", "звёзд")}</span></button>
      </div>

      <section className={styles.badges} aria-label="Значки">
        <div className={styles.sectionHead}><h3>Значки</h3><span>скоро</span></div>
        <div className={styles.badgeRow} aria-hidden="true">{[0, 1, 2, 3].map((slot) => <span key={slot}>?</span>)}</div>
        <p>Скоро здесь появятся твои значки за достижения в команде.</p>
      </section>

      <section className={styles.stars} ref={starsRef} aria-label="Мои звёзды">
        <div className={styles.sectionHead}><h3>Звёзды</h3><span>★ {stars}</span></div>
        {myStars.length === 0 ? <p className={styles.empty}>Звёзд пока нет. Их дают наставники за особые успехи.</p>
          : myStars.map((award) => <div className={styles.star} key={award.id}>
            <b>★ {award.stars}</b>
            <span><strong>{starKind(award.kind) || "Звёзды"}{award.mentorName && <> · от {award.mentorName}</>}</strong>
              {award.comment && <em>«{award.comment}»</em>}<small>{formatDate(award.createdAt)}</small></span>
          </div>)}
      </section>

      <TelegramConnect telegramId={user.telegramId} busy={telegramBusy} onLink={onLinkTelegram} onRefresh={onRefreshTelegram} onUnlink={onUnlinkTelegram} />

      {user.teamId && <div className="profile-invite-card"><div><strong>Твоя ссылка в команду</strong><small>Бессрочная ссылка. Вступление подтверждает наставник.</small></div>
        {inviteUrl ? <>
          <div className="profile-invite-controls"><input aria-label="Твоя ссылка приглашения" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="button button-edit" onClick={() => { void onCopyInvite(inviteUrl); }}>Копировать</button></div>
          <div className={styles.inviteActions}>
            <button type="button" className="button button-primary" onClick={() => void share()}>Поделиться</button>
            <button type="button" className="button button-edit" aria-expanded={showQr} onClick={() => setShowQr(!showQr)}>{showQr ? "Скрыть QR-код" : "QR-код"}</button>
          </div>
          {showQr && <div className={styles.qr}><QrCode value={inviteUrl} size={200} label="QR-код ссылки-приглашения" /><p>Покажи этот код: человек наведёт камеру телефона и сразу попадёт на регистрацию в твою команду.</p></div>}
        </> : <button type="button" className="button button-primary" disabled={inviteBusy} onClick={onCreateInvite}>{inviteBusy ? "Создаём..." : "Получить ссылку"}</button>}</div>}

      <section className={styles.security} aria-label="Безопасность">
        <div><h3>Пароль</h3><p>Смени пароль, если кто-то мог его узнать. Остальные устройства выйдут из аккаунта.</p></div>
        <button type="button" className="button button-edit" onClick={() => setMode("password")}>Сменить пароль</button>
      </section>

      <div className={styles.logout}><button type="button" className="button button-danger" onClick={onLogout}>Выйти из аккаунта</button></div>
    </div></SectionBoundary>}
  </ModalSheet>
    {leave && <ConfirmModal title="Выйти без сохранения?" eyebrow="Изменения не сохранены" description="Введённые изменения пропадут. Чтобы их сохранить, вернитесь и нажмите кнопку сохранения."
      confirmLabel="Выйти без сохранения" cancelLabel="Продолжить редактирование" onClose={() => setLeave(null)}
      onConfirm={() => { const action = leave; setLeave(null); setDirty(false); action(); }} />}
  </>;
}
