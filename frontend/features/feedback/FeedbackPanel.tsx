"use client";

import { plural } from "@/frontend/shared/lib/plural";
import { useEffect, useRef, useState } from "react";
import { request } from "@/frontend/shared/api/client";
import styles from "./FeedbackPanel.module.css";

type Thread = { id: string; taskId: string | null; taskTitle: string; memberId: string; memberName: string; lastAt: string; lastKind: string; lastBody: string; needsReply: boolean; unread: boolean; lastSeq: number };
type Event = { id: string; seq: number; kind: "submission" | "review" | "message"; submissionId: string | null; authorId: string | null; authorName: string; body: string; reviewStatus: "accepted" | "revision" | null; points: number | null; createdAt: string };
type Detail = Pick<Thread, "id" | "taskId" | "taskTitle" | "memberId" | "memberName"> & { events: Event[] };
type TaskGroup = { key: string; title: string; participants: number; needsReply: number; unread: number; lastAt: string };

function date(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function participantsLabel(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  return `${count} ${lastTwo >= 11 && lastTwo <= 14 ? "участников" : last === 1 ? "участник" : last >= 2 && last <= 4 ? "участника" : "участников"}`;
}

export function FeedbackPanel({ viewerId, mentor = false, refreshKey = 0, selectedTaskId, selectedThreadId }: {
  viewerId: string; mentor?: boolean; refreshKey?: number; selectedTaskId?: string | null; selectedThreadId?: string | null;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [filter, setFilter] = useState<"all" | "reply">("all");
  const [draft, setDraft] = useState("");
  const [nonce, setNonce] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [moreGroups, setMoreGroups] = useState(false);
  const [moreThreads, setMoreThreads] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [groupOffset, setGroupOffset] = useState(0);
  const [threadOffset, setThreadOffset] = useState(0);
  const [error, setError] = useState("");
  const appliedTarget = useRef("");
  const scope = mentor ? "mentor" : "personal";
  const listContext = `${scope}:${filter}:${selectedTaskKey || ""}`;
  const currentListContext = useRef(listContext);
  const selectedUnread = threads.some((item) => item.id === selectedId && item.unread);

  useEffect(() => { currentListContext.current = listContext; }, [listContext]);

  useEffect(() => {
    let active = true;
    async function loadInbox() {
      try {
        if (mentor) {
          const { groups } = await request<{ groups: TaskGroup[] }>(`/api/feedback?scope=mentor&view=tasks&filter=${filter}&offset=0`, { cache: "no-store" });
          if (!active) return;
          setTaskGroups(groups);
          setGroupOffset(groups.length);
          setMoreGroups(groups.length === 50);
          const target = selectedThreadId ? `thread:${selectedThreadId}` : "";
          if (target && appliedTarget.current !== target) {
            try {
              const { thread } = await request<{ thread: Detail }>(`/api/feedback/${selectedThreadId}?scope=mentor`, { cache: "no-store" });
              if (!active) return;
              appliedTarget.current = target;
              setParticipantsLoading(true);
              setSelectedTaskKey(thread.taskId || thread.id);
              setSelectedId(thread.id);
              setDetail(thread);
              if (!groups.some((group) => group.key === (thread.taskId || thread.id))) {
                setTaskGroups((current) => [{ key: thread.taskId || thread.id, title: thread.taskTitle,
                  participants: 1, needsReply: 0, unread: 0, lastAt: thread.events.at(-1)?.createdAt || new Date().toISOString() }, ...current]);
              }
            } catch { /* A stale or inaccessible deep link does not open another thread. */ }
          }
        } else {
          const { threads: loaded } = await request<{ threads: Thread[] }>(`/api/feedback?scope=personal&filter=${filter}&offset=0`, { cache: "no-store" });
          if (!active) return;
          setThreads(loaded);
          setThreadOffset(loaded.length);
          setMoreThreads(loaded.length === 50);
          const target = selectedThreadId ? `thread:${selectedThreadId}` : selectedTaskId ? `task:${selectedTaskId}` : "";
          if (target && appliedTarget.current !== target) {
            const match = selectedThreadId ? loaded.find((thread) => thread.id === selectedThreadId) : loaded.find((thread) => thread.taskId === selectedTaskId);
            if (match) { appliedTarget.current = target; setSelectedId(match.id); }
          }
        }
        if (active) { setLoading(false); setError(""); }
      } catch { if (active) { setLoading(false); setError("Не удалось загрузить обратную связь."); } }
    }
    void loadInbox();
    return () => { active = false; };
  }, [viewerId, refreshKey, selectedTaskId, selectedThreadId, filter, mentor, scope]);

  useEffect(() => {
    if (!mentor || !selectedTaskKey) return;
    let active = true;
    void request<{ threads: Thread[] }>(`/api/feedback?scope=mentor&taskKey=${selectedTaskKey}&filter=${filter}&offset=0`, { cache: "no-store" }).then(({ threads: loaded }) => {
      if (!active) return;
      setThreads(loaded);
      setThreadOffset(loaded.length);
      setMoreThreads(loaded.length === 50);
      setParticipantsLoading(false);
    }).catch(() => { if (active) { setParticipantsLoading(false); setError("Не удалось загрузить участников."); } });
    return () => { active = false; };
  }, [mentor, selectedTaskKey, filter, refreshKey]);

  async function loadMore() {
    const taskPage = mentor && !selectedTaskKey;
    if (!(taskPage ? moreGroups : moreThreads) || loadingMore) return;
    const requestedContext = listContext;
    setLoadingMore(true);
    try {
      if (taskPage) {
        const { groups: next } = await request<{ groups: TaskGroup[] }>(`/api/feedback?scope=mentor&view=tasks&filter=${filter}&offset=${groupOffset}`, { cache: "no-store" });
        if (currentListContext.current !== requestedContext) return;
        setTaskGroups((current) => [...current, ...next.filter((item) => !current.some((seen) => seen.key === item.key))]);
        setGroupOffset((value) => value + next.length);
        setMoreGroups(next.length === 50);
      } else {
        const taskQuery = mentor ? `&taskKey=${selectedTaskKey}` : "";
        const { threads: next } = await request<{ threads: Thread[] }>(`/api/feedback?scope=${scope}${taskQuery}&filter=${filter}&offset=${threadOffset}`, { cache: "no-store" });
        if (currentListContext.current !== requestedContext) return;
        setThreads((current) => [...current, ...next.filter((item) => !current.some((seen) => seen.id === item.id))]);
        setThreadOffset((value) => value + next.length);
        setMoreThreads(next.length === 50);
      }
    } catch { setError("Не удалось загрузить следующую страницу."); }
    finally { setLoadingMore(false); }
  }

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void request<{ thread: Detail }>(`/api/feedback/${selectedId}?scope=${scope}`, { cache: "no-store" }).then(async ({ thread }) => {
      if (!active) return;
      setDetail(thread); setError("");
      const latest = thread.events.at(-1);
      if (latest && latest.authorId !== viewerId) {
        await request(`/api/feedback/${selectedId}/read?scope=${scope}`, { method: "POST" }).catch(() => undefined);
        if (active) {
          setThreads((items) => items.map((item) => item.id === selectedId ? { ...item, unread: false } : item));
          if (mentor && selectedUnread) setTaskGroups((items) => items.map((item) => item.key === (thread.taskId || thread.id) ? { ...item, unread: Math.max(0, item.unread - 1) } : item));
        }
      }
    }).catch(() => { if (active) { setSelectedId(null); setError("Не удалось открыть переписку. Обновите список."); } });
    return () => { active = false; };
  }, [selectedId, refreshKey, viewerId, scope, mentor, selectedUnread]);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedId || !text || busy) return;
    setBusy(true); setError("");
    try {
      await request(`/api/feedback/${selectedId}?scope=${scope}`, { method: "POST", body: JSON.stringify({ body: text, nonce }) });
      setDraft(""); setNonce(crypto.randomUUID());
      try {
        const taskQuery = mentor ? `&taskKey=${selectedTaskKey}` : "";
        const [{ thread }, { threads: updated }] = await Promise.all([
          request<{ thread: Detail }>(`/api/feedback/${selectedId}?scope=${scope}`, { cache: "no-store" }),
          request<{ threads: Thread[] }>(`/api/feedback?scope=${scope}${taskQuery}&filter=${filter}&offset=0`, { cache: "no-store" }),
        ]);
        setDetail(thread);
        setThreads((current) => filter === "reply" ? updated : [...updated, ...current.filter((item) => !updated.some((fresh) => fresh.id === item.id))]);
        setMoreThreads(updated.length === 50); setThreadOffset(updated.length);
        if (mentor) {
          const { groups } = await request<{ groups: TaskGroup[] }>(`/api/feedback?scope=mentor&view=tasks&filter=${filter}&offset=0`, { cache: "no-store" });
          setTaskGroups((current) => filter === "reply" ? groups : [...groups, ...current.filter((item) => !groups.some((fresh) => fresh.key === item.key))]);
          setMoreGroups(groups.length === 50); setGroupOffset(groups.length);
        }
      } catch { setError("Сообщение отправлено, но список пока не обновился. Перезагрузите страницу."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Сообщение не отправлено. Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }

  const selectedGroup = selectedTaskKey ? taskGroups.find((group) => group.key === selectedTaskKey) : null;
  const visible = threads;
  const showTaskList = mentor && !selectedTaskKey;
  const showConversation = !mentor || !!selectedTaskKey;
  return <div className={styles.shell}>
<div className={styles.heading}><div>{!mentor && <><p className={styles.eyebrow}>Ваши задания</p><h2>Обратная связь</h2></>}<p>{mentor ? "Выберите задание, затем участника — история и ответ откроются рядом." : "Здесь ваши работы, решения и сообщения наставника."}</p></div>{mentor && <div className={styles.filters}><button type="button" className={filter === "all" ? styles.active : ""} onClick={() => { if (filter !== "all") { setLoading(true); setSelectedId(null); setSelectedTaskKey(null); setThreads([]); setFilter("all"); } }}>Все</button><button type="button" className={filter === "reply" ? styles.active : ""} onClick={() => { if (filter !== "reply") { setLoading(true); setSelectedId(null); setSelectedTaskKey(null); setThreads([]); setFilter("reply"); } }}>Нужен ответ</button></div>}</div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {loading ? <p className={styles.empty}>Загружаем переписки…</p> : <>
      {mentor && selectedTaskKey && <div className={styles.breadcrumb}><button type="button" onClick={() => { setSelectedTaskKey(null); setSelectedId(null); setDetail(null); }}>← Все задания</button><span aria-hidden="true">/</span><strong>{selectedGroup?.title || detail?.taskTitle || "Задание"}</strong></div>}
      {showTaskList && <div className={styles.taskGrid} aria-label="Задания с обратной связью">
        {taskGroups.length === 0 && <p className={styles.empty}>{filter === "reply" ? "Сейчас никто не ждёт ответа." : "Переписки появятся после отправки работ."}</p>}
        {taskGroups.map((group) => <button type="button" key={group.key} className={styles.taskCard} onClick={() => { setParticipantsLoading(true); setSelectedTaskKey(group.key); setSelectedId(null); setDetail(null); setThreads([]); }}>
          <span className={styles.taskCardTop}><span className={styles.taskIcon}>☷</span><span>{date(group.lastAt)}</span></span>
          <strong>{group.title}</strong><span className={styles.taskCardBottom}>{participantsLabel(group.participants)}{group.needsReply > 0 && <b>{group.needsReply} {plural(group.needsReply, "ждёт", "ждут", "ждут")} ответа</b>}{group.unread > 0 && <i aria-label={`${group.unread} непрочитанных`}>{group.unread} {plural(group.unread, "новое", "новых", "новых")}</i>}</span>
        </button>)}
        {moreGroups && <button type="button" className={styles.more} disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Загружаем…" : "Показать ещё задания"}</button>}
      </div>}
      {showConversation && <div className={styles.layout}>
        <div className={`${styles.list} ${selectedId ? styles.hasSelection : ""}`} aria-label={mentor ? "Участники задания" : "Ваши переписки"}>
          {mentor && <div className={styles.listHeading}>Участники <span>{selectedGroup?.participants ?? visible.length}</span></div>}
          {participantsLoading && <p className={styles.empty}>Загружаем участников…</p>}
          {!participantsLoading && visible.length === 0 && <p className={styles.empty}>{mentor && filter === "reply" ? "По этому заданию больше нет ожидающих ответа." : "Переписки появятся после отправки работы."}</p>}
          {visible.map((thread) => <button type="button" key={thread.id} className={`${styles.item} ${selectedId === thread.id ? styles.selected : ""}`} onClick={() => { setSelectedId(thread.id); setDetail(null); }}>
            <span className={styles.itemTop}><strong>{mentor ? thread.memberName : thread.taskTitle}</strong>{thread.unread && <span className={styles.dot} aria-label="Непрочитано" />}</span>
            <span className={styles.preview}>{thread.lastKind === "review" ? "Решение наставника" : thread.lastBody || "Работа отправлена"}</span>
            <span className={styles.meta}>{date(thread.lastAt)}{mentor && thread.needsReply && <b>Нужен ответ</b>}</span>
          </button>)}
          {!participantsLoading && moreThreads && <button type="button" className={styles.more} disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Загружаем…" : "Показать ещё участников"}</button>}
        </div>
        <div className={`${styles.conversation} ${selectedId ? styles.open : ""}`}>
          {!selectedId ? <div className={styles.conversationPlaceholder}><span>✉</span><strong>Выберите {mentor ? "участника" : "задание"}</strong><p>История переписки и поле ответа появятся здесь.</p></div> : !detail || detail.id !== selectedId ? <p className={styles.empty}>Открываем переписку…</p> : <>
            <div className={styles.conversationHead}><button type="button" className={styles.back} onClick={() => setSelectedId(null)}>← Назад</button><div><strong>{mentor ? detail.memberName : detail.taskTitle}</strong><span>{mentor ? detail.taskTitle : "Переписка с наставником"}</span></div></div>
            <div className={styles.events} aria-live="polite">{detail.events.map((item) => item.kind === "message" ? <article key={item.id} className={`${styles.message} ${item.authorId === viewerId ? styles.own : ""}`}>
              <div className={styles.eventTop}><strong>{item.authorId === viewerId ? "Вы" : item.authorName}</strong><time dateTime={item.createdAt}>{date(item.createdAt)}</time></div>
              <p className={styles.body}>{item.body}</p>
            </article> : <article key={item.id} className={`${styles.activity} ${item.kind === "review" && item.reviewStatus === "accepted" ? styles.accepted : ""} ${item.kind === "review" && item.reviewStatus === "revision" ? styles.revision : ""}`}>
              <span className={styles.activityIcon}>{item.kind === "submission" ? "↗" : item.reviewStatus === "accepted" ? "✓" : "↺"}</span>
              <div><div className={styles.activityTop}><strong>{item.kind === "submission" ? "Работа отправлена" : item.reviewStatus === "accepted" ? `Работа принята · +${item.points ?? 0} миль` : "Нужна доработка"}</strong><time dateTime={item.createdAt}>{date(item.createdAt)}</time></div>
                {item.body && <p className={styles.body}>{item.body}</p>}</div>
            </article>)}</div>
            <form className={styles.composer} onSubmit={(event) => void send(event)}><label htmlFor="feedback-message">Сообщение {mentor ? "участнику" : "наставнику"}</label><textarea id="feedback-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} rows={3} placeholder="Напишите сообщение…" /><div><small>Сообщение не меняет статус работы и мили.</small><button type="submit" disabled={busy || !draft.trim()}>{busy ? "Отправляем…" : "Отправить"}</button></div></form>
          </>}
        </div>
      </div>}
    </>}
  </div>;
}
