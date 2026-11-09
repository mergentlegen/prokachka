"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AuthUser, Store, User } from "@/shared/domain/types";
import { Avatar } from "@/frontend/shared/Avatar";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import { SectionBoundary } from "@/frontend/shared/SectionBoundary";
import { ProfileEditor } from "@/frontend/features/profile/ProfileEditor";
import { PasswordChangeForm } from "@/frontend/features/profile/PasswordChangeForm";
import { loadProfileExtras, type ProfileExtras } from "@/frontend/shared/api/profile-client";
import { QrCode } from "@/frontend/shared/QrCode";
import { STAR_AWARD_OPTIONS } from "@/shared/domain/star-awards";
import { formatDate, milesUnit } from "@/frontend/shared/lib/format";
import { formatPhone } from "@/shared/domain/phone";
import { plural } from "@/frontend/shared/lib/plural";
import { LEVEL_UP_MILES, levelBadges, levelLabel, levelTitle } from "@/shared/domain/levels";
import styles from "./MemberProfile.module.css";

const BADGE_SLOTS = 4;
/** The newest awards are shown; the rest open with «Показать все». */
const STARS_SHOWN = 3;

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
const icons = {
  pen: icon("M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4"),
  telegram: icon("M21 4 3 11l6 2.5M21 4l-3 16-9-6.5M21 4 9 13.5V19l3-3.5"),
  phone: icon("M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM11 18h2"),
  lock: icon("M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3"),
};

const starKind = (kind?: string) => STAR_AWARD_OPTIONS.find((option) => option.kind === kind)?.label;

export function MemberProfile({ loading, error, onRetry, user, store, rank, points, stars, level = 1, telegramBusy, onLinkTelegram, onRefreshTelegram, inviteUrl, inviteBusy, onCreateInvite, onCopyInvite, onProfileSaved, onNotice, onOpenDone, onOpenRanking, onUnlinkTelegram, onClose, onLogout }: {
  loading?: boolean; error?: string; onRetry?: () => void; user: User; store: Store; rank: number; points: number; stars: number; level?: number;
  telegramBusy: boolean; onLinkTelegram: () => void; onRefreshTelegram: () => void;
  inviteUrl: string; inviteBusy: boolean; onCreateInvite: () => void; onCopyInvite: (url: string) => void | Promise<void>;
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
  const [copied, setCopied] = useState(false);
  const [allStars, setAllStars] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const starsRef = useRef<HTMLElement>(null);
  const badges = levelBadges(level);
  const telegramLinked = Boolean(user.telegramId);
  const reveal = (section: { current: HTMLElement | null }) => section.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  async function share() {
    if (!inviteUrl) return;
    try {
      if (navigator.share) await navigator.share({ title: "Приглашение в команду", text: "Присоединяйся к моей команде в Прокачке:", url: inviteUrl });
      else await copy();
    } catch (cause) { if (!(cause instanceof Error && cause.name === "AbortError")) void copy(); }
  }
  async function copy() {
    await onCopyInvite(inviteUrl);
    setCopied(true);
  }
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

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
  const shownStars = allStars ? myStars : myStars.slice(0, STARS_SHOWN);
  const milesLeft = Math.max(LEVEL_UP_MILES - points, 0);

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
          {level > 1 && <p className={styles.level}><span aria-hidden="true">★</span>{levelLabel(level)}</p>}
          <p>{extras?.teamName ? <>Участник команды «{extras.teamName}»</> : "Участник команды"}</p>
          <ul className={styles.facts}>
            {user.teamJoinedAt && <li><span aria-hidden="true">📅</span>В команде с {cleanYear(joinedFormat.format(new Date(user.teamJoinedAt)))}</li>}
            {extras?.mentorName && <li><span aria-hidden="true">🧭</span>Наставник: {extras.mentorName}</li>}
          </ul>
          <button type="button" className={styles.edit} onClick={() => setMode("edit")} aria-label="Редактировать профиль">{icons.pen}Редактировать</button>
        </div>
      </section>

      <div className={styles.stats}>
        <button type="button" className={styles.statMiles} onClick={onOpenRanking} aria-label={`${points} ${milesUnit(points)} — открыть рейтинг`}><i aria-hidden="true">{statIcons.miles}</i><strong>{points}</strong><span>{milesUnit(points)}</span></button>
        <button type="button" className={styles.statRank} onClick={onOpenRanking} aria-label={`Место ${rank || "—"} — открыть рейтинг`}><i aria-hidden="true">{statIcons.rank}</i><strong>{rank || "—"}</strong><span>место</span></button>
        <button type="button" className={styles.statDone} onClick={() => guard(onOpenDone)} aria-label={`Выполнено ${done} — открыть выполненные задания`}><i aria-hidden="true">{statIcons.done}</i><strong>{done}</strong><span>выполнено</span></button>
        <button type="button" className={styles.statStars} onClick={() => reveal(starsRef)} aria-label={`${stars} звёзд — за что`}><i aria-hidden="true">{statIcons.stars}</i><strong>{stars}</strong><span>{plural(stars, "звезда", "звезды", "звёзд")}</span></button>
      </div>
      {level === 1 && milesLeft > 0 && <div className={styles.next}>
        <span className={styles.bar} role="progressbar" aria-label={`Мили до уровня 2 «${levelTitle(2)}»`} aria-valuemin={0} aria-valuemax={LEVEL_UP_MILES} aria-valuenow={Math.min(points, LEVEL_UP_MILES)}><i style={{ "--part": `${(Math.min(points, LEVEL_UP_MILES) / LEVEL_UP_MILES) * 100}%` } as CSSProperties} /></span>
        <small>До уровня «{levelTitle(2)}» — {milesLeft} {milesUnit(milesLeft)}</small>
      </div>}

      <section className={styles.card} aria-label="Значки">
        <div className={styles.head}><h3>Значки</h3><span>{badges.length ? `${badges.length} из ${BADGE_SLOTS}` : "скоро"}</span></div>
        <div className={styles.badgeRow}>
          {badges.map((badge) => <figure key={badge.key} className={styles.earned} title={badge.note}><span aria-hidden="true">{badge.icon}</span><figcaption>{badge.title}</figcaption></figure>)}
          {Array.from({ length: Math.max(0, BADGE_SLOTS - badges.length) }, (_, slot) => <span key={slot} className={styles.slot} aria-hidden="true">?</span>)}
        </div>
        <p className={styles.note}>{badges.length ? `${badges.map((badge) => `«${badge.title}» — ${badge.note}`).join(". ")}. Новые значки появятся за следующие достижения.` : "Скоро здесь появятся твои значки за достижения в команде."}</p>
      </section>

      <section className={`${styles.card} ${styles.stars}`} ref={starsRef} aria-label="Мои звёзды">
        <div className={styles.head}><h3>Звёзды</h3><span className={styles.gold}>★ {stars}</span></div>
        {myStars.length === 0 ? <p className={styles.note}>Звёзд пока нет. Их дают наставники за особые успехи.</p> : <>
          <ul className={styles.starList}>{shownStars.map((award) => <li className={styles.star} key={award.id}>
            <b>★ {award.stars}</b>
            <span><strong>{starKind(award.kind) || "Звёзды"}{award.mentorName && <> · от {award.mentorName}</>}</strong>
              {award.comment && <em>«{award.comment}»</em>}<small>{formatDate(award.createdAt)}</small></span>
          </li>)}</ul>
          {myStars.length > STARS_SHOWN && <button type="button" className={styles.more} aria-expanded={allStars} onClick={() => setAllStars(!allStars)}>{allStars ? "Свернуть" : `Показать все (${myStars.length})`}</button>}
        </>}
      </section>

      {user.teamId && <section className={styles.card} aria-label="Пригласить в команду">
        <div className={styles.head}><h3>Пригласить в команду</h3></div>
        <p className={styles.note}>Бессрочная ссылка. Вступление подтверждает наставник.</p>
        {inviteUrl ? <>
          <div className={styles.link}>
            <input aria-label="Твоя ссылка приглашения" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className={copied ? styles.copied : undefined} onClick={() => void copy()}>{copied ? "Скопировано ✓" : "Копировать"}</button>
          </div>
          <div className={styles.inviteActions}>
            <button type="button" className="button button-primary" onClick={() => void share()}>Поделиться</button>
            <button type="button" className="button button-edit" aria-expanded={showQr} onClick={() => setShowQr(!showQr)}>{showQr ? "Скрыть QR-код" : "QR-код"}</button>
          </div>
          {showQr && <div className={styles.qr}><QrCode value={inviteUrl} size={200} label="QR-код ссылки-приглашения" /><p>Покажи этот код: человек наведёт камеру телефона и сразу попадёт на регистрацию в твою команду.</p></div>}
        </> : <button type="button" className={`button button-primary ${styles.wide}`} disabled={inviteBusy} onClick={onCreateInvite}>{inviteBusy ? "Создаём..." : "Получить ссылку"}</button>}
      </section>}

      <section className={styles.card} aria-label="Настройки">
        <div className={styles.head}><h3>Настройки</h3></div>
        <ul className={styles.rows}>
          <li className={styles.row}>
            <span className={`${styles.rowIcon} ${styles.toneTelegram}`} aria-hidden="true">{icons.telegram}</span>
            {telegramLinked && unlinking ? <span className={styles.rowText}><strong>Отвязать Telegram?</strong>
              <small>Бот перестанет принимать твои ответы и присылать уведомления, пока ты не привяжешь Telegram снова — этот же или другой.</small>
              <span className={styles.rowButtons}>
                <button type="button" className="button button-danger" disabled={telegramBusy} onClick={() => { void Promise.resolve(onUnlinkTelegram()).finally(() => setUnlinking(false)); }}>{telegramBusy ? "Отвязываем..." : "Отвязать"}</button>
                <button type="button" className="button button-edit" disabled={telegramBusy} onClick={() => setUnlinking(false)}>Отмена</button>
              </span></span>
              : <><span className={styles.rowText}><strong>Telegram</strong>{telegramLinked ? <small className={styles.ok}><i aria-hidden="true" />Подключён</small> : <small>Нужен, чтобы отправлять ответы через бота</small>}</span>
                <span className={styles.rowAction}>{telegramLinked
                  ? <button type="button" className={styles.textButton} disabled={telegramBusy} onClick={() => setUnlinking(true)}>Отвязать</button>
                  : <><button type="button" className={`button button-telegram ${styles.small}`} disabled={telegramBusy} onClick={onLinkTelegram}>{telegramBusy ? "Открываем..." : "Привязать"}</button>
                    <button type="button" className={styles.textButton} disabled={telegramBusy} onClick={() => { void onRefreshTelegram(); }}>Проверить</button></>}</span></>}
          </li>
          <li><button type="button" className={`${styles.row} ${styles.rowLink}`} onClick={() => setMode("edit")} disabled={extras === null}>
            <span className={`${styles.rowIcon} ${styles.tonePhone}`} aria-hidden="true">{icons.phone}</span>
            <span className={styles.rowText}><strong>Телефон</strong><small>{extras?.phone ? <>{formatPhone(extras.phone)} · видят только наставники</> : "Не указан — наставник сможет позвонить"}</small></span>
            <span className={styles.rowAction}><b>{extras?.phone ? "Изменить" : "Добавить"}</b><span className={styles.chevron} aria-hidden="true">›</span></span>
          </button></li>
          <li><button type="button" className={`${styles.row} ${styles.rowLink}`} onClick={() => setMode("password")}>
            <span className={`${styles.rowIcon} ${styles.toneLock}`} aria-hidden="true">{icons.lock}</span>
            <span className={styles.rowText}><strong>Пароль</strong><small>Остальные устройства выйдут из аккаунта</small></span>
            <span className={styles.rowAction}><b>Сменить</b><span className={styles.chevron} aria-hidden="true">›</span></span>
          </button></li>
        </ul>
      </section>

      <button type="button" className={styles.logout} onClick={onLogout}>Выйти из аккаунта</button>
    </div></SectionBoundary>}
  </ModalSheet>
    {leave && <ConfirmModal title="Выйти без сохранения?" eyebrow="Изменения не сохранены" description="Введённые изменения пропадут. Чтобы их сохранить, вернитесь и нажмите кнопку сохранения."
      confirmLabel="Выйти без сохранения" cancelLabel="Продолжить редактирование" onClose={() => setLeave(null)}
      onConfirm={() => { const action = leave; setLeave(null); setDirty(false); action(); }} />}
  </>;
}
