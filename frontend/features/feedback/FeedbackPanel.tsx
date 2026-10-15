"use client";

import { plural } from "@/frontend/shared/lib/plural";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { request } from "@/frontend/shared/api/client";
import { Avatar } from "@/frontend/shared/Avatar";
import styles from "./FeedbackPanel.module.css";

type Thread = { id: string; taskId: string | null; taskTitle: string; memberId: string; memberName: string; avatarUrl?: string; lastAt: string; lastKind: string; lastBody: string; needsReply: boolean; unread: boolean; lastSeq: number; waitingSince?: string | null };
type Event = { id: string; seq: number; kind: "submission" | "review" | "message"; submissionId: string | null; authorId: string | null; authorName: string; body: string; reviewStatus: "accepted" | "revision" | null; points: number | null; createdAt: string };
type Person = { id: string; name: string; avatarUrl?: string };
type Detail = Pick<Thread, "id" | "taskId" | "taskTitle" | "memberId" | "memberName"> & { events: Event[]; people?: Person[]; needsReply?: boolean; memberSeenSeq?: number };
type TaskGroup = { key: string; title: string; participants: number; needsReply: number; unread: number; lastAt: string };
type Page<T> = { items: T[]; more: boolean };
const PAGE = 50;
const DAY = 24 * 60 * 60 * 1000;
const noPage = { items: [], more: false };

function participantsLabel(count: number) {
  return `${count} ${plural(count, "участник", "участника", "участников")}`;
}
function merge<T>(current: T[], next: T[], key: (item: T) => string) {
  return [...current, ...next.filter((item) => !current.some((seen) => key(seen) === key(item)))];
}
const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0);
const clockFormat = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const dayYearFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const shortFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

/** «Сегодня», «Вчера», «12 октября»; another year also shows the year. */
export function dayLabel(iso: string, now = Date.now()) {
  const day = startOfDay(Date.parse(iso)), today = startOfDay(now);
  if (day === today) return "Сегодня";
  if (day === startOfDay(today - DAY / 2)) return "Вчера";
  return (new Date(day).getFullYear() === new Date(today).getFullYear() ? dayFormat : dayYearFormat).format(new Date(iso));
}
/** List time: «14:05» today, «вчера», then «12 окт.». */
export function listTime(iso: string, now = Date.now()) {
  const label = dayLabel(iso, now);
  return label === "Сегодня" ? clockFormat.format(new Date(iso)) : label === "Вчера" ? "вчера" : shortFormat.format(new Date(iso));
}
/** «ждёт 20 мин», «ждёт 3 ч», «ждёт 2 дня». */
export function waitingLabel(iso: string, now = Date.now()) {
  const minutes = Math.max(1, Math.floor((now - Date.parse(iso)) / 60000));
  if (minutes < 60) return `ждёт ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `ждёт ${hours} ч`;
  const days = Math.floor(hours / 24);
  return `ждёт ${days} ${plural(days, "день", "дня", "дней")}`;
}

export function FeedbackPanel({ viewerId, mentor = false, refreshKey = 0, selectedTaskId, selectedThreadId, templates = [], onOpenSubmission, onReview, onOpenTask, onChange }: {
  viewerId: string; mentor?: boolean; refreshKey?: number; selectedTaskId?: string | null; selectedThreadId?: string | null;
  templates?: string[]; onOpenSubmission?: (submissionId: string) => void;
  /** «Принять» / «На доработку» straight from the conversation. */
  onReview?: (submissionId: string, intent: "accepted" | "revision") => void;
  /** «Исправить работу»: the participant goes to the task. */
  onOpenTask?: (taskId: string) => void;
  /** Something changed the mentor counters (a reply or «Ответ не нужен»). */
  onChange?: () => void;
}) {
  const [mode, setMode] = useState<"waiting" | "tasks">("waiting");
  const [waiting, setWaiting] = useState<Page<Thread>>(noPage);
  const [groups, setGroups] = useState<Page<TaskGroup>>(noPage);
  const [taskThreads, setTaskThreads] = useState<Page<Thread>>(noPage);
  const [mine, setMine] = useState<Page<Thread>>(noPage);
  const [found, setFound] = useState<Thread[] | null>(null);
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [nonce, setNonce] = useState(() => crypto.randomUUID());
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const appliedTarget = useRef("");
  const eventsBox = useRef<HTMLDivElement>(null);
  const unreadIds = useRef(new Set<string>());
  const scope = mentor ? "mentor" : "personal";
  const search = query.trim();
  const searchKey = search.toLocaleLowerCase("ru");

  useEffect(() => {
    let active = true;
    async function loadInbox() {
      try {
        if (mentor) {
          const [{ threads }, { groups: loadedGroups }] = await Promise.all([
            request<{ threads: Thread[] }>("/api/feedback?scope=mentor&view=inbox&filter=reply&offset=0", { cache: "no-store" }),
            request<{ groups: TaskGroup[] }>("/api/feedback?scope=mentor&view=tasks&filter=all&offset=0", { cache: "no-store" }),
          ]);
          if (!active) return;
          setWaiting({ items: threads, more: threads.length === PAGE });
          setGroups({ items: loadedGroups, more: loadedGroups.length === PAGE });
          setNow(Date.now());
          const target = selectedThreadId ? `thread:${selectedThreadId}` : "";
          if (target && appliedTarget.current !== target) {
            try {
              const { thread } = await request<{ thread: Detail }>(`/api/feedback/${selectedThreadId}?scope=mentor`, { cache: "no-store" });
              if (!active) return;
              appliedTarget.current = target;
              if (!threads.some((item) => item.id === thread.id)) { setMode("tasks"); setParticipantsLoading(true); setSelectedTaskKey(thread.taskId || thread.id); }
              setSelectedId(thread.id);
              setDetail(thread);
              if (!loadedGroups.some((group) => group.key === (thread.taskId || thread.id))) {
                setGroups((current) => ({ ...current, items: [{ key: thread.taskId || thread.id, title: thread.taskTitle,
                  participants: 1, needsReply: 0, unread: 0, lastAt: thread.events.at(-1)?.createdAt || new Date().toISOString() }, ...current.items] }));
              }
            } catch { /* A stale or inaccessible deep link does not open another thread. */ }
          }
        } else {
          const { threads } = await request<{ threads: Thread[] }>("/api/feedback?scope=personal&filter=all&offset=0", { cache: "no-store" });
          if (!active) return;
          setMine({ items: threads, more: threads.length === PAGE });
          setNow(Date.now());
          const target = selectedThreadId ? `thread:${selectedThreadId}` : selectedTaskId ? `task:${selectedTaskId}` : "";
          if (target && appliedTarget.current !== target) {
            const match = selectedThreadId ? threads.find((thread) => thread.id === selectedThreadId) : threads.find((thread) => thread.taskId === selectedTaskId);
            if (match) { appliedTarget.current = target; setSelectedId(match.id); }
          }
        }
        if (active) { setLoading(false); setError(""); }
      } catch { if (active) { setLoading(false); setError("Не удалось загрузить обратную связь."); } }
    }
    void loadInbox();
    return () => { active = false; };
  }, [viewerId, refreshKey, version, selectedTaskId, selectedThreadId, mentor]);

  useEffect(() => {
    if (!mentor || !selectedTaskKey) return;
    let active = true;
    void request<{ threads: Thread[] }>(`/api/feedback?scope=mentor&taskKey=${selectedTaskKey}&filter=all&offset=0`, { cache: "no-store" }).then(({ threads }) => {
      if (!active) return;
      setTaskThreads({ items: threads, more: threads.length === PAGE });
      setParticipantsLoading(false);
    }).catch(() => { if (active) { setParticipantsLoading(false); setError("Не удалось загрузить участников."); } });
    return () => { active = false; };
  }, [mentor, selectedTaskKey, refreshKey, version]);

  // A participant is found by name across every task, on the server, so nobody has to scroll through pages.
  useEffect(() => {
    if (!mentor || selectedTaskKey || !search) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void request<{ threads: Thread[] }>(`/api/feedback?scope=mentor&view=inbox&filter=all&offset=0&q=${encodeURIComponent(search)}`, { cache: "no-store" })
        .then(({ threads }) => { if (active) setFound(threads); })
        .catch(() => { if (active) setError("Поиск не сработал. Попробуйте ещё раз."); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [mentor, selectedTaskKey, search, refreshKey, version]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void request<{ thread: Detail }>(`/api/feedback/${selectedId}?scope=${scope}`, { cache: "no-store" }).then(async ({ thread }) => {
      if (!active) return;
      setDetail(thread); setError("");
      const latest = thread.events.at(-1);
      if (latest && latest.authorId !== viewerId) {
        await request(`/api/feedback/${selectedId}/read?scope=${scope}`, { method: "POST" }).catch(() => undefined);
        if (!active) return;
        const read = (page: Page<Thread>) => ({ ...page, items: page.items.map((item) => item.id === selectedId ? { ...item, unread: false } : item) });
        setWaiting(read); setTaskThreads(read); setMine(read);
        if (mentor && unreadIds.current.has(thread.id)) {
          unreadIds.current.delete(thread.id);
          setGroups((page) => ({ ...page, items: page.items.map((group) => group.key === (thread.taskId || thread.id) ? { ...group, unread: Math.max(0, group.unread - 1) } : group) }));
        }
        setFound((items) => items && items.map((item) => item.id === selectedId ? { ...item, unread: false } : item));
      }
    }).catch(() => { if (active) { setSelectedId(null); setError("Не удалось открыть переписку. Обновите список."); } });
    return () => { active = false; };
  }, [selectedId, refreshKey, version, viewerId, scope, mentor]);

  // The newest message is in view when a conversation opens or grows.
  const eventCount = detail?.id === selectedId ? detail?.events.length || 0 : 0;
  useEffect(() => { const box = eventsBox.current; if (eventCount && box) box.scrollTop = box.scrollHeight; }, [eventCount, selectedId]);

  async function loadMore(kind: "waiting" | "groups" | "task" | "mine") {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      if (kind === "groups") {
        const { groups: next } = await request<{ groups: TaskGroup[] }>(`/api/feedback?scope=mentor&view=tasks&filter=all&offset=${groups.items.length}`, { cache: "no-store" });
        setGroups((current) => ({ items: merge(current.items, next, (item) => item.key), more: next.length === PAGE }));
      } else {
        const page = kind === "waiting" ? waiting : kind === "task" ? taskThreads : mine;
        const set = kind === "waiting" ? setWaiting : kind === "task" ? setTaskThreads : setMine;
        const url = kind === "waiting" ? "/api/feedback?scope=mentor&view=inbox&filter=reply"
          : kind === "task" ? `/api/feedback?scope=mentor&taskKey=${selectedTaskKey}&filter=all` : "/api/feedback?scope=personal&filter=all";
        const { threads: next } = await request<{ threads: Thread[] }>(`${url}&offset=${page.items.length}`, { cache: "no-store" });
        set((current) => ({ items: merge(current.items, next, (item) => item.id), more: next.length === PAGE }));
      }
    } catch { setError("Не удалось загрузить следующую страницу."); }
    finally { setLoadingMore(false); }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedId || !text || busy) return;
    setBusy(true); setError("");
    try {
      await request(`/api/feedback/${selectedId}?scope=${scope}`, { method: "POST", body: JSON.stringify({ body: text, nonce }) });
      setDraft(""); setNonce(crypto.randomUUID()); setTemplatesOpen(false);
      setVersion((value) => value + 1);
      onChange?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Сообщение не отправлено. Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }

  async function dismiss() {
    if (!selectedId || busy) return;
    setBusy(true); setError("");
    try {
      await request(`/api/feedback/${selectedId}/dismiss?scope=mentor`, { method: "POST" });
      setDetail((current) => current && { ...current, needsReply: false });
      setVersion((value) => value + 1);
      onChange?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не получилось. Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }

  function openThread(id: string) { setSelectedId(id); setDetail(null); setDraft(""); setTemplatesOpen(false); }
  function openTask(key: string) { setQuery(""); setMode("tasks"); setParticipantsLoading(true); setSelectedTaskKey(key); setSelectedId(null); setDetail(null); setTaskThreads(noPage); }
  function showMode(next: "waiting" | "tasks") { setMode(next); setQuery(""); setSelectedTaskKey(null); setSelectedId(null); setDetail(null); }
  function applyTemplate(text: string) { setDraft((value) => value.trim() ? `${value.trim()} ${text}` : text); setTemplatesOpen(false); }

  const selectedGroup = selectedTaskKey ? groups.items.find((group) => group.key === selectedTaskKey) : null;
  const searching = mentor && !selectedTaskKey && Boolean(search);
  const foundTasks = searching ? groups.items.filter((group) => group.title.toLocaleLowerCase("ru").includes(searchKey)).slice(0, 6) : [];
  const listItems = !mentor ? mine.items
    : selectedTaskKey ? (search ? taskThreads.items.filter((thread) => thread.memberName.toLocaleLowerCase("ru").includes(searchKey)) : taskThreads.items)
      : searching ? found || [] : mode === "waiting" ? waiting.items : [];
  const listMore = !mentor ? mine.more && "mine" : selectedTaskKey ? !search && taskThreads.more && "task" : !searching && mode === "waiting" && waiting.more && "waiting";
  const showTaskGrid = mentor && !selectedTaskKey && !searching && mode === "tasks";
  const waitingCount = waiting.more ? `${waiting.items.length}+` : String(waiting.items.length);
  useEffect(() => { unreadIds.current = new Set([...waiting.items, ...taskThreads.items, ...(found || [])].filter((thread) => thread.unread).map((thread) => thread.id)); });
  const people = new Map((detail?.people || []).map((person) => [person.id, person]));
  const workStatus = detail ? latestWorkStatus(detail.events) : null;
  const memberSide = (item: Event) => Boolean(detail) && item.authorId === detail!.memberId;
  const lastMentorEvent = detail ? [...detail.events].reverse().find((item) => item.kind !== "submission" && !memberSide(item)) : undefined;
  const mentorPerson = lastMentorEvent?.authorId ? people.get(lastMentorEvent.authorId) : undefined;
  const listLabel = !mentor ? "Ваши переписки" : selectedTaskKey ? "Участники задания" : searching ? "Найденные участники" : "Ждут ответа";
  const emptyText = !mentor ? "Переписки появятся после отправки работы."
    : searching ? (found === null ? "Ищем…" : "Никого не нашли.")
      : selectedTaskKey ? (search ? "Никого не нашли среди участников задания." : "У задания пока нет переписок.")
        : "Сейчас никто не ждёт ответа. Все переписки — во вкладке «По заданиям».";

  const row = (thread: Thread) => <button type="button" key={thread.id} className={`${styles.item} ${selectedId === thread.id ? styles.selected : ""}`} onClick={() => openThread(thread.id)}>
    {mentor && <Avatar name={thread.memberName} src={thread.avatarUrl} className={styles.rowAvatar} />}
    <span className={styles.itemMain}>
      <span className={styles.itemTop}><strong>{mentor ? thread.memberName : thread.taskTitle}</strong><time dateTime={thread.lastAt}>{listTime(thread.lastAt, now)}</time></span>
      {mentor && !selectedTaskKey && <span className={styles.itemTask}>{thread.taskTitle}</span>}
      <span className={styles.itemBottom}><span className={styles.preview}>{thread.lastKind === "review" ? "Решение наставника" : thread.lastBody || "Работа отправлена"}</span>
        {mentor && thread.needsReply && thread.waitingSince ? <b className={styles.wait}>{waitingLabel(thread.waitingSince, now)}</b> : mentor && thread.needsReply ? <b className={styles.wait}>ждёт ответа</b> : null}
        {thread.unread && <span className={styles.dot} aria-label="Непрочитано" />}</span>
    </span>
  </button>;

  const taskCard = (group: TaskGroup) => <button type="button" key={group.key} className={styles.taskCard} onClick={() => openTask(group.key)}>
    <span className={styles.taskCardTop}><span className={styles.taskIcon} aria-hidden="true">☷</span><span>{listTime(group.lastAt, now)}</span></span>
    <strong>{group.title}</strong><span className={styles.taskCardBottom}>{participantsLabel(group.participants)}{group.needsReply > 0 && <b>{group.needsReply} {plural(group.needsReply, "ждёт", "ждут", "ждут")} ответа</b>}{group.unread > 0 && <i aria-label={`${group.unread} непрочитанных`}>{group.unread} {plural(group.unread, "новое", "новых", "новых")}</i>}</span>
  </button>;

  const conversation = !selectedId ? <div className={styles.conversationPlaceholder}><span aria-hidden="true">✉</span><strong>Выберите {mentor ? "участника" : "задание"}</strong><p>История переписки и поле ответа появятся здесь.</p></div>
    : !detail || detail.id !== selectedId ? <p className={styles.empty}>Открываем переписку…</p> : <>
      <div className={styles.conversationHead}>
        <button type="button" className={styles.back} onClick={() => setSelectedId(null)} aria-label="Назад к списку">←</button>
        {mentor ? <Avatar name={detail.memberName} src={people.get(detail.memberId)?.avatarUrl} className={styles.headAvatar} />
          : <Avatar name={mentorPerson?.name || "Наставник"} src={mentorPerson?.avatarUrl} className={styles.headAvatar} />}
        <div className={styles.headMain}>
          <strong>{mentor ? detail.memberName : mentorPerson?.name || "Наставник"}</strong>
          <span>{mentor ? detail.taskTitle : `Наставник · ${detail.taskTitle}`}</span>
          {workStatus && <span className={styles.workLine}><b className={`${styles.workStatus} ${styles[`work_${workStatus.status}`]}`}>{workStatus.label}</b></span>}
        </div>
        <div className={styles.headActions}>
          {mentor && workStatus?.status === "pending" && onReview ? <>
            <button type="button" className={styles.accept} onClick={() => onReview(workStatus.submissionId, "accepted")}>Принять</button>
            <button type="button" className={styles.revise} onClick={() => onReview(workStatus.submissionId, "revision")}>На доработку</button>
          </> : mentor && workStatus && onOpenSubmission ? <button type="button" className={styles.ghost} onClick={() => onOpenSubmission(workStatus.submissionId)}>Открыть работу</button> : null}
          {mentor && detail.needsReply && <button type="button" className={styles.ghost} disabled={busy} onClick={() => void dismiss()}>Ответ не нужен</button>}
          {!mentor && workStatus?.status === "revision" && detail.taskId && onOpenTask && <button type="button" className={styles.accept} onClick={() => onOpenTask(detail.taskId!)}>Исправить работу</button>}
        </div>
      </div>
      <div className={styles.events} aria-live="polite" ref={eventsBox}>
        {detail.events.map((item, index) => {
          const previous = detail.events[index - 1];
          const day = dayLabel(item.createdAt, now);
          const separator = !previous || dayLabel(previous.createdAt, now) !== day ? <div className={styles.day}><span>{day}</span></div> : null;
          const time = <time dateTime={item.createdAt}>{clockFormat.format(new Date(item.createdAt))}</time>;
          const receipt = mentor && item === lastMentorEvent ? <small className={styles.receipt}>{(detail.memberSeenSeq || 0) >= item.seq ? "✓✓ Прочитано" : "✓ Отправлено"}</small> : null;
          if (item.kind === "message") {
            const own = item.authorId === viewerId;
            const author = item.authorId ? people.get(item.authorId) : undefined;
            return <Fragment key={item.id}>{separator}
              <div className={`${styles.messageRow} ${own ? styles.ownRow : ""}`}>
                {!own && <Avatar name={author?.name || item.authorName} src={author?.avatarUrl} className={styles.msgAvatar} />}
                <article className={`${styles.message} ${own ? styles.own : ""}`}>
                  {!own && item.authorId !== (mentor ? detail.memberId : mentorPerson?.id) && <strong className={styles.author}>{item.authorName}</strong>}
                  <p className={styles.body}>{item.body}</p>
                  {time}
                </article>
              </div>
              {receipt}
            </Fragment>;
          }
          return <Fragment key={item.id}>{separator}
            <article className={`${styles.activity} ${item.kind === "review" && item.reviewStatus === "accepted" ? styles.accepted : ""} ${item.kind === "review" && item.reviewStatus === "revision" ? styles.revision : ""}`}>
              <span className={styles.activityIcon} aria-hidden="true">{item.kind === "submission" ? "↗" : item.reviewStatus === "accepted" ? "✓" : "↺"}</span>
              <div><div className={styles.activityTop}><strong>{item.kind === "submission" ? "Работа отправлена" : item.reviewStatus === "accepted" ? `Работа принята · +${item.points ?? 0} миль` : "Нужна доработка"}</strong>{time}</div>
                {item.kind === "review" && <small className={styles.activityAuthor}>{item.authorId === viewerId ? "Вы" : item.authorName}</small>}
                {item.body && <p className={styles.body}>{item.body}</p>}</div>
            </article>
            {receipt}
          </Fragment>;
        })}
      </div>
      <form className={styles.composer} onSubmit={(event) => void send(event)}>
        <label htmlFor="feedback-message" className={styles.srOnly}>Сообщение {mentor ? "участнику" : "наставнику"}</label>
        {mentor && templates.length > 0 && <>
          <button type="button" className={styles.templatesToggle} aria-expanded={templatesOpen} onClick={() => setTemplatesOpen(!templatesOpen)}>Шаблоны <i aria-hidden="true" /></button>
          {templatesOpen && <div className={styles.templates} aria-label="Готовые комментарии">{templates.map((text) => <button type="button" key={text} onClick={() => applyTemplate(text)}>{text}</button>)}</div>}
        </>}
        <div className={styles.composeRow}>
          <textarea id="feedback-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} rows={2} placeholder={mentor ? "Сообщение участнику…" : "Сообщение наставнику…"} />
          <button type="submit" disabled={busy || !draft.trim()} aria-label="Отправить">{busy ? "…" : "Отправить"}</button>
        </div>
        <small>Сообщение не меняет статус работы и мили.</small>
      </form>
    </>;

  return <div className={styles.shell}>
    <div className={styles.heading}>
      <div>{!mentor && <><p className={styles.eyebrow}>Ваши задания</p><h2>Обратная связь</h2></>}<p>{mentor ? "Сначала те, кто ждёт ответа дольше всех. Все переписки — по заданиям." : "Здесь ваши работы, решения и сообщения наставника."}</p></div>
      {mentor && <div className={styles.filters} role="tablist" aria-label="Переписки">
        <button type="button" role="tab" aria-selected={mode === "waiting"} className={mode === "waiting" ? styles.active : ""} onClick={() => showMode("waiting")}>Ждут ответа{waiting.items.length > 0 && <b>{waitingCount}</b>}</button>
        <button type="button" role="tab" aria-selected={mode === "tasks"} className={mode === "tasks" ? styles.active : ""} onClick={() => showMode("tasks")}>По заданиям</button>
      </div>}
    </div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {loading ? <p className={styles.empty}>Загружаем переписки…</p> : <>
      {mentor && <label className={styles.search}><span>{selectedTaskKey ? "Поиск участника задания" : "Поиск участника или задания"}</span>
        <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setFound(null); }} placeholder={selectedTaskKey ? "Имя участника" : "Имя участника или задание"} /></label>}
      {mentor && selectedTaskKey && <div className={styles.breadcrumb}><button type="button" onClick={() => showMode("tasks")}>← Все задания</button><span aria-hidden="true">/</span><strong>{selectedGroup?.title || detail?.taskTitle || "Задание"}</strong></div>}
      {foundTasks.length > 0 && <div className={styles.foundTasks}><h3>Задания</h3><div className={styles.taskGrid}>{foundTasks.map(taskCard)}</div></div>}
      {showTaskGrid && <div className={styles.taskGrid} aria-label="Задания с обратной связью">
        {groups.items.length === 0 && <p className={styles.empty}>Переписки появятся после отправки работ.</p>}
        {groups.items.map(taskCard)}
        {groups.more && <button type="button" className={styles.more} disabled={loadingMore} onClick={() => void loadMore("groups")}>{loadingMore ? "Загружаем…" : "Показать ещё задания"}</button>}
      </div>}
      {!showTaskGrid && !(searching && !selectedId && found?.length === 0 && foundTasks.length > 0) && <div className={styles.layout}>
        <div className={styles.list} aria-label={listLabel}>
          {mentor && <div className={styles.listHeading}>{listLabel} <span>{selectedTaskKey ? selectedGroup?.participants ?? listItems.length : searching ? listItems.length : waitingCount}</span></div>}
          {participantsLoading && selectedTaskKey ? <p className={styles.empty}>Загружаем участников…</p> : listItems.length === 0 ? <p className={styles.empty}>{emptyText}</p> : listItems.map(row)}
          {!participantsLoading && listMore && <button type="button" className={styles.more} disabled={loadingMore} onClick={() => void loadMore(listMore)}>{loadingMore ? "Загружаем…" : "Показать ещё"}</button>}
        </div>
        <div className={`${styles.conversation} ${selectedId ? styles.open : ""}`}>{conversation}</div>
      </div>}
    </>}
  </div>;
}

// The state of the participant's latest work in this thread, read from the event history.
export function latestWorkStatus(events: Event[]): { submissionId: string; status: "pending" | "accepted" | "revision"; label: string } | null {
  let submissionId = "", status: "pending" | "accepted" | "revision" | "" = "";
  for (const item of events) {
    if (!item.submissionId) continue;
    if (item.kind === "submission") { submissionId = item.submissionId; status = "pending"; }
    else if (item.kind === "review" && item.reviewStatus && item.submissionId === submissionId) status = item.reviewStatus;
    else if (item.kind === "review" && item.reviewStatus && !submissionId) { submissionId = item.submissionId; status = item.reviewStatus; }
  }
  if (!submissionId || !status) return null;
  return { submissionId, status, label: status === "accepted" ? "Работа принята" : status === "revision" ? "На доработке" : "Ждёт проверки" };
}
