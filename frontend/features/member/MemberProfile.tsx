"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthUser, Store, SubmissionStatus, Task, User } from "@/shared/domain/types";
import { Avatar } from "@/frontend/shared/Avatar";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import { SectionBoundary } from "@/frontend/shared/SectionBoundary";
import { ProfileEditor } from "@/frontend/features/profile/ProfileEditor";
import { PasswordChangeForm } from "@/frontend/features/profile/PasswordChangeForm";
import { TelegramConnect } from "@/frontend/features/telegram/TelegramConnect";
import { loadMyPrograms, loadProfileExtras, type MyProgram, type ProfileExtras } from "@/frontend/shared/api/profile-client";
import { QrCode } from "@/frontend/shared/QrCode";
import { STAR_AWARD_OPTIONS } from "@/shared/domain/star-awards";
import { formatDate, formatMiles, milesUnit } from "@/frontend/shared/lib/format";
import { formatPhone } from "@/shared/domain/phone";
import styles from "./MemberProfile.module.css";

type HistoryStatus = SubmissionStatus | "missed";
type Filter = "all" | HistoryStatus;
type HistoryItem = { id: string; taskId: string; title: string; date: string; status: HistoryStatus; points: number; comment: string; fromMentor: boolean };
type Mode = "view" | "edit" | "password";

const statusLabels: Record<HistoryStatus, string> = { accepted: "Принято", pending: "На проверке", revision: "На доработке", missed: "Просрочено" };
const filterLabels: [Filter, string][] = [["all", "Все"], ["accepted", "Принято"], ["pending", "На проверке"], ["revision", "На доработке"], ["missed", "Пропущено"]];
const joinedFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const monthFormat = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
const cleanYear = (text: string) => text.replace(/\s*г\.$/, "");
const monthTitle = (date: string) => { const text = cleanYear(monthFormat.format(new Date(date))); return text.charAt(0).toUpperCase() + text.slice(1); };

function expired(task: Task, now: number) {
  const deadline = task.dueAt || task.deadlineAt;
  return Boolean(deadline && new Date(deadline).getTime() <= now);
}

/** Everything the participant sent, plus tasks whose time ran out without an answer; newest first. */
export function profileHistory(user: User, store: Store, now: number): HistoryItem[] {
  const submissions = store.submissions.filter((submission) => submission.userId === user.id);
  const submitted = new Set(submissions.map((submission) => submission.taskId));
  return [
    ...submissions.map((submission) => ({
      id: submission.id, taskId: submission.taskId, title: submission.taskTitle || store.tasks.find((task) => task.id === submission.taskId)?.title || "Задание",
      date: submission.submittedAt, status: submission.status as HistoryStatus, points: submission.points, comment: submission.comment || "", fromMentor: Boolean(submission.comment),
    })),
    ...store.tasks.filter((task) => expired(task, now) && !submitted.has(task.id)).map((task) => ({
      id: `missed-${task.id}`, taskId: task.id, title: task.title, date: task.dueAt || task.deadlineAt || task.createdAt, status: "missed" as const, points: 0, fromMentor: false,
      comment: task.isActive && task.publicationType === "sequential" ? "Можно отправить с опозданием." : "Срок сдачи истёк, отправить работу больше нельзя.",
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
}

export type MilesMonth = { title: string; tasks: number; games: number; stars: number };

/** «Откуда мои мили»: accepted work by month — tasks checked by mentors and games checked by the site; stars apart. */
export function milesStatement(user: User, store: Store): MilesMonth[] {
  const months = new Map<string, MilesMonth & { key: string }>();
  const month = (date: string) => {
    const key = date.slice(0, 7);
    if (!months.has(key)) months.set(key, { key, title: monthTitle(date), tasks: 0, games: 0, stars: 0 });
    return months.get(key)!;
  };
  for (const item of store.submissions) {
    if (item.userId !== user.id || item.status !== "accepted" || !item.points) continue;
    const row = month(item.reviewedAt || item.submittedAt);
    if (item.source === "interactive") row.games += item.points; else row.tasks += item.points;
  }
  for (const award of store.starAwards) if (award.userId === user.id) month(award.createdAt).stars += award.stars;
  return [...months.values()].sort((a, b) => b.key.localeCompare(a.key)).map(({ key: _key, ...row }) => row);
}

const starKind = (kind?: string) => STAR_AWARD_OPTIONS.find((option) => option.kind === kind)?.label;

export function MemberProfile({ loading, error, onRetry, user, store, now, rank, points, stars, telegramBusy, onLinkTelegram, onRefreshTelegram, inviteUrl, inviteBusy, onCreateInvite, onCopyInvite, onProfileSaved, onNotice, openableTaskIds, onOpenTask, onOpenRanking, onUnlinkTelegram, onClose, onLogout }: {
  loading?: boolean; error?: string; onRetry?: () => void; user: User; store: Store; now: number; rank: number; points: number; stars: number;
  telegramBusy: boolean; onLinkTelegram: () => void; onRefreshTelegram: () => void;
  inviteUrl: string; inviteBusy: boolean; onCreateInvite: () => void; onCopyInvite: (url: string) => void;
  onProfileSaved: (user: AuthUser) => void; onNotice: (message: string) => void;
  /** Tasks that can be opened in the feed right now (history rows for them become links). */
  openableTaskIds: ReadonlySet<string>; onOpenTask: (taskId: string) => void;
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
  const [filter, setFilter] = useState<Filter>("all");
  const [programs, setPrograms] = useState<MyProgram[] | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [allMonths, setAllMonths] = useState(false);
  const milesRef = useRef<HTMLElement>(null);
  const starsRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLElement>(null);
  const reveal = (section: { current: HTMLElement | null }) => section.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  useEffect(() => {
    let active = true;
    void loadMyPrograms().then((loaded) => { if (active) setPrograms(loaded); }).catch(() => { if (active) setPrograms([]); });
    return () => { active = false; };
  }, []);

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

  const history = profileHistory(user, store, now);
  const counts = history.reduce((map, item) => map.set(item.status, (map.get(item.status) || 0) + 1), new Map<HistoryStatus, number>());
  const shown = filter === "all" ? history : history.filter((item) => item.status === filter);
  const months = shown.reduce((groups, item) => {
    const title = monthTitle(item.date);
    const last = groups[groups.length - 1];
    if (last?.title === title) last.items.push(item); else groups.push({ title, items: [item] });
    return groups;
  }, [] as { title: string; items: HistoryItem[] }[]);
  const done = new Set(store.submissions.filter((item) => item.userId === user.id && item.status === "accepted" && item.interactiveCompleted !== false).map((item) => item.taskId)).size;
  const miles = milesStatement(user, store);
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

      <div className={`profile-stats ${styles.stats}`}>
        <button type="button" onClick={() => reveal(milesRef)} aria-label={`${points} ${milesUnit(points)} — откуда мили`}><strong>{points}</strong><span>{milesUnit(points)}</span></button>
        <button type="button" onClick={onOpenRanking} aria-label={`Место ${rank || "—"} — открыть рейтинг`}><strong>{rank || "—"}</strong><span>место</span></button>
        <button type="button" onClick={() => { setFilter("accepted"); reveal(historyRef); }} aria-label={`Выполнено ${done} — показать в истории`}><strong>{done}</strong><span>выполнено</span></button>
        <button type="button" onClick={() => reveal(starsRef)} aria-label={`${stars} звёзд — за что`}><strong>{stars}</strong><span>звёзд</span></button>
      </div>

      {programs && programs.length > 0 && <section className={styles.programs} aria-label="Мои программы">
        <div className={styles.sectionHead}><h3>Мои программы</h3><span>{programs.length}</span></div>
        {programs.map((program) => {
          const finished = program.status === "completed";
          const step = finished ? program.totalSteps : Math.max(0, (program.currentStep || 1) - 1);
          return <div className={styles.program} key={program.programId}>
            <div className={styles.programHead}><strong>{program.title}</strong><span className={finished ? styles.programDone : ""}>{finished ? "Пройдена ✓" : `Шаг ${program.currentStep || 1} из ${program.totalSteps}`}</span></div>
            <i className={styles.programBar} aria-hidden="true"><i style={{ width: `${program.totalSteps ? (step / program.totalSteps) * 100 : 0}%` }} /></i>
            {!finished && program.currentTaskId && openableTaskIds.has(program.currentTaskId) && <button type="button" className="button button-edit" onClick={() => guard(() => onOpenTask(program.currentTaskId!))}>Продолжить →</button>}
          </div>;
        })}
      </section>}

      <section className={styles.badges} aria-label="Значки">
        <div className={styles.sectionHead}><h3>Значки</h3><span>скоро</span></div>
        <div className={styles.badgeRow} aria-hidden="true">{[0, 1, 2, 3].map((slot) => <span key={slot}>?</span>)}</div>
        <p>Скоро здесь появятся твои значки за достижения в команде.</p>
      </section>

      <section className={styles.miles} ref={milesRef} aria-label="Откуда мои мили">
        <div className={styles.sectionHead}><h3>Откуда мои мили</h3><span>{points} {milesUnit(points)}</span></div>
        {miles.length === 0 ? <p className={styles.empty}>Мили появятся, когда наставник примет первое задание.</p> : <>
          {(allMonths ? miles : miles.slice(0, 3)).map((month) => <div className={styles.milesRow} key={month.title}>
            <strong>{month.title}</strong>
            <span>{month.tasks > 0 && <span>задания <b>+{month.tasks}</b></span>}{month.games > 0 && <span>игры <b>+{month.games}</b></span>}{month.stars > 0 && <span>звёзды <b className={styles.starCount}>★ {month.stars}</b></span>}</span>
          </div>)}
          {miles.length > 3 && <button type="button" className={styles.more} onClick={() => setAllMonths(!allMonths)}>{allMonths ? "Свернуть" : `Все месяцы (${miles.length})`}</button>}
          <p className={styles.hint}>Задания проверяет наставник, игры — сайт. Звёзды идут в отдельный рейтинг.</p>
        </>}
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

      <section className={styles.history} ref={historyRef} aria-label="История заданий">
        <div className={styles.sectionHead}><h3>История заданий</h3><span>{history.length}</span></div>
        {history.length > 0 && <div className={styles.filters} role="group" aria-label="Показать">
          {filterLabels.filter(([key]) => key === "all" || counts.get(key)).map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key}
            className={filter === key ? styles.filterOn : ""} onClick={() => setFilter(key)}>{label} <b>{key === "all" ? history.length : counts.get(key)}</b></button>)}
        </div>}
        {history.length === 0 ? <p className={styles.empty}>Ты ещё ничего не отправлял(а). Задания ждут во вкладке «Задания».</p>
          : months.map((month) => <div className={styles.month} key={month.title}>
            <h4>{month.title}</h4>
            {month.items.map((item) => {
              const body = <>
                <span className={styles.rowMain}><strong>{item.title}</strong><small>{formatDate(item.date)}</small>
                  {item.comment && <em className={item.fromMentor ? styles.mentorNote : styles.note}>{item.fromMentor && <b>Наставник: </b>}{item.comment}</em>}</span>
                <span className={`history-status status-${item.status}`}>{statusLabels[item.status]}{item.status === "accepted" && ` +${formatMiles(item.points)}`}</span>
              </>;
              return openableTaskIds.has(item.taskId)
                ? <button type="button" key={item.id} className={`${styles.row} ${styles.rowLink}`} onClick={() => guard(() => onOpenTask(item.taskId))} aria-label={`Открыть задание «${item.title}»`}>{body}<span className={styles.arrow} aria-hidden="true">›</span></button>
                : <div key={item.id} className={styles.row}>{body}</div>;
            })}
          </div>)}
      </section>

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
