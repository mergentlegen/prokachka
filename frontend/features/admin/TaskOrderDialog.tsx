"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { ApiError, request } from "@/frontend/shared/api/client";
import { moveTaskOrder } from "@/shared/domain/task-feed-order";
import type { TaskOrderItem, TaskOrderSnapshot } from "@/shared/domain/task-feed-order";
import styles from "./TaskOrderDialog.module.css";

export function TaskOrderDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [snapshot, setSnapshot] = useState<TaskOrderSnapshot | null>(null);
  const [items, setItems] = useState<TaskOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [dragged, setDragged] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: string; original: TaskOrderItem[]; y: number; active: boolean; frame: number } | null>(null);
  const latestItems = useRef(items);
  const saving = useRef(false);
  const dirty = Boolean(snapshot && items.some((item, index) => item.key !== snapshot.items[index]?.key));

  function load() { setLoading(true); setError(""); setConflict(false); setLoadVersion((value) => value + 1); }
  useEffect(() => {
    let cancelled = false;
    void request<{ order: TaskOrderSnapshot }>("/api/tasks/order", { cache: "no-store" }).then((response) => {
      if (!cancelled) { setSnapshot(response.order); setItems(response.order.items); latestItems.current = response.order.items; }
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить задания."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; if (drag.current) cancelAnimationFrame(drag.current.frame); };
  }, [loadVersion]);

  function move(key: string, target: string) {
    const next = moveTaskOrder(latestItems.current, key, target);
    if (next === latestItems.current) return;
    latestItems.current = next; setItems(next);
    const item = next.find((row) => row.key === key)!;
    const group = next.filter((row) => row.isPinned === item.isPinned);
    setAnnouncement(`${item.title}: позиция ${group.findIndex((row) => row.key === key) + 1} из ${group.length}.`);
  }
  function shift(key: string, direction: number) {
    const item = latestItems.current.find((row) => row.key === key);
    if (!item) return;
    const group = latestItems.current.filter((row) => row.isPinned === item.isPinned);
    const target = group[group.findIndex((row) => row.key === item.key) + direction];
    if (target) move(item.key, target.key);
  }
  function finishDrag(cancelled = false) {
    const current = drag.current;
    if (!current) return;
    cancelAnimationFrame(current.frame);
    if (cancelled) { latestItems.current = current.original; setItems(current.original); }
    drag.current = null; setDragged("");
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (busy || conflict || event.button !== 0) return;
    const key = event.currentTarget.dataset.key;
    if (!key) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { key, original: latestItems.current, y: event.clientY, active: false, frame: 0 };
  }
  function keyboardMove(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault(); shift(event.currentTarget.dataset.key || "", event.key === "ArrowUp" ? -1 : 1);
    }
  }
  function dragMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current) return;
    if (!current.active && Math.abs(event.clientY - current.y) < 5) return;
    if (!current.active) { current.active = true; setDragged(current.key); }
    current.y = event.clientY;
    const tick = () => {
      const active = drag.current;
      if (!active?.active) return;
      const scroll = root.current?.closest<HTMLElement>("[data-modal-scroll]");
      if (scroll) {
        const bounds = scroll.getBoundingClientRect();
        const speed = active.y < bounds.top + 64 ? -10 : active.y > bounds.bottom - 90 ? 10 : 0;
        if (speed) scroll.scrollTop += speed;
      }
      const source = latestItems.current.find((item) => item.key === active.key);
      const rows = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-order-key]") || []);
      const target = rows.find((row) => {
        const bounds = row.getBoundingClientRect();
        return active.y >= bounds.top && active.y <= bounds.bottom && row.dataset.pinned === String(source?.isPinned);
      });
      if (target?.dataset.orderKey) move(active.key, target.dataset.orderKey);
      active.frame = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(current.frame); current.frame = requestAnimationFrame(tick);
  }
  async function save(inherit = false) {
    if (!snapshot || saving.current || conflict) return;
    saving.current = true; setBusy(true); setError("");
    try {
      await request("/api/tasks/order", { method: "PUT", body: JSON.stringify({ revision: snapshot.revision,
        pinned: items.filter((item) => item.isPinned).map((item) => item.key), regular: items.filter((item) => !item.isPinned).map((item) => item.key), inherit }) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить порядок. Попробуйте ещё раз.");
      setConflict(cause instanceof ApiError && cause.status === 409);
    } finally { saving.current = false; setBusy(false); }
  }

  return <ModalSheet title="Порядок заданий" variant="immersive" onClose={() => { if (!saving.current) onClose(); }}>
    <div className={styles.content} ref={root} onKeyDown={(event) => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); finishDrag(true); }
    }}>
      <div className={styles.intro}>
        <span className={styles.eyebrow}>{snapshot?.scope === "branch" ? "Для вашей ветки" : "Для всей команды"}</span>
        <h3>Расставьте задания по порядку</h3>
        <p>Перетащите за ручку или используйте стрелки. Участники увидят изменения после сохранения.</p>
        {snapshot?.scope === "branch" && <p className={styles.scopeNote}>Ваш порядок действует в вашей ветке. Вложенные ветки со своим порядком сохранят его.</p>}
        {snapshot?.scope === "team" && <p className={styles.scopeNote}>Общие задания команды. Наставники веток могут настроить свою расстановку.</p>}
      </div>
      {loading ? <p className={styles.empty} role="status">Загружаем задания…</p> : <>
        {snapshot && snapshot.items.length === 0 && <p className={styles.empty}>Пока нет опубликованных заданий. Добавьте задание или готовую игру.</p>}
        {snapshot && [true, false].map((pinned) => {
          const group = items.filter((item) => item.isPinned === pinned);
          return <section key={String(pinned)} className={styles.group} aria-label={pinned ? "Закреплённые" : "Остальные задания"}>
            <div className={styles.groupHeading}><h4>{pinned ? "Закреплённые" : "Остальные задания"}</h4><span>{group.length}</span></div>
            {group.length === 0 ? <p className={styles.groupEmpty}>{pinned ? "Закреплённых заданий нет" : "Обычных публикаций пока нет"}</p> : <ol className={styles.list}>
              {group.map((item, index) => <li key={item.key} data-order-key={item.key} data-pinned={String(pinned)} className={`${styles.row} ${dragged === item.key ? styles.dragged : ""}`}>
                <button type="button" data-key={item.key} className={styles.handle} aria-label={`Переместить: ${item.title}`} title="Перетащите или используйте клавиши ↑ и ↓" disabled={busy || conflict}
                  onPointerDown={startDrag} onPointerMove={dragMove} onPointerUp={() => finishDrag()} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag()}
                  onKeyDown={keyboardMove}><span aria-hidden="true">⠿</span></button>
                <span className={styles.number} aria-hidden="true">{index + 1}</span>
                <div className={styles.details}><strong>{item.title}</strong><span>{item.kind ? "Готовая игра" : "Задание"}{item.authorName ? ` · ${item.authorName}` : ""}</span></div>
                <div className={styles.arrows}>
                  <button type="button" data-key={item.key} disabled={busy || conflict || index === 0} aria-label={`Выше: ${item.title}`} onClick={(event) => shift(event.currentTarget.dataset.key || "", -1)}>↑</button>
                  <button type="button" data-key={item.key} disabled={busy || conflict || index === group.length - 1} aria-label={`Ниже: ${item.title}`} onClick={(event) => shift(event.currentTarget.dataset.key || "", 1)}>↓</button>
                </div>
              </li>)}
            </ol>}
          </section>;
        })}
      </>}
      <p className={styles.srOnly} role="status" aria-live="polite">{announcement}</p>
      {error && <div className={styles.error} role="alert"><p>{error}</p>{(conflict || !snapshot) && <button type="button" disabled={loading} onClick={() => void load()}>Обновить список</button>}</div>}
      <footer className={styles.footer}>
        <div className={styles.actions}><button type="button" className="primary-button" disabled={loading || busy || conflict || !dirty || Boolean(dragged)} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить порядок"}</button>
          <button type="button" className={styles.cancel} disabled={busy} onClick={onClose}>Отмена</button></div>
        {snapshot?.customized && <button type="button" className={styles.reset} disabled={busy || loading || conflict} onClick={() => void save(true)}>{snapshot.scope === "branch" ? "Вернуть порядок вышестоящего наставника" : "Вернуть порядок по дате публикации и закрепления"}</button>}
      </footer>
    </div>
  </ModalSheet>;
}
