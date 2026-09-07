"use client";

import { useState } from "react";
import { formatDateTime } from "@/frontend/shared/lib/format";
import { createAdminAnnouncement, deleteAdminAnnouncement, updateAdminAnnouncement } from "@/frontend/shared/api/admin-client";
import type { Announcement } from "@/shared/domain/types";

type Draft = { title: string; content: string };
type Props = {
  announcements: Announcement[];
  onChange: (announcements: Announcement[]) => void;
  onError: (message: string) => void;
};

export function AnnouncementsPanel({ announcements, onChange, onError }: Props) {
  const [draft, setDraft] = useState<Draft>({ title: "", content: "" });
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState(false);

  function openCreate() {
    setEditing(null);
    setDraft({ title: "", content: "" });
    setEditorOpen(true);
  }

  function openEdit(announcement: Announcement) {
    setEditing(announcement);
    setDraft({ title: announcement.title, content: announcement.content });
    setEditorOpen(true);
  }

  function closeEditor() {
    if (!busy) setEditorOpen(false);
  }

  async function save() {
    const title = draft.title.trim();
    const content = draft.content.trim();
    if (title.length < 2) return onError("Укажи заголовок объявления.");
    if (content.length < 2) return onError("Добавь текст объявления.");

    setBusy(true);
    try {
      if (editing) {
        const updated = await updateAdminAnnouncement(editing.id, { title, content });
        onChange(announcements.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await createAdminAnnouncement({ title, content });
        onChange([created, ...announcements]);
      }
      setEditorOpen(false);
      setEditing(null);
      setDraft({ title: "", content: "" });
      onError("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось сохранить объявление.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteAdminAnnouncement(deleteTarget.id);
      onChange(announcements.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      onError("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось удалить объявление.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(announcement: Announcement) {
    setBusy(true);
    try {
      const updated = await updateAdminAnnouncement(announcement.id, { isActive: !announcement.isActive });
      onChange(announcements.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось изменить статус объявления.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="announcement-admin-toolbar">
        <div>
          <p className="eyebrow">Для своей команды</p>
          <p className="admin-muted">Публикуй важные новости и инструкции для участников.</p>
        </div>
        <button className="button button-primary" onClick={openCreate}>+ Новое объявление</button>
      </div>

      <div className="admin-panel announcement-admin-list">
        {announcements.length === 0 ? (
          <div className="empty-admin"><span>✦</span><p>Пока нет объявлений. Создай первое для команды.</p></div>
        ) : (
          announcements.map((announcement) => (
            <article className="announcement-admin-row" key={announcement.id}>
              <div className="announcement-admin-copy">
                <div className="announcement-admin-meta">
                  <span className={announcement.isActive ? "announcement-live" : "announcement-hidden"}>
                    {announcement.isActive ? "Опубликовано" : "Скрыто"}
                  </span>
                  <time>{formatDateTime(announcement.createdAt)}</time>
                </div>
                <h3>{announcement.title}</h3>
                <p>{announcement.content}</p>
              </div>
              <div className="announcement-admin-actions">
                <button className="button button-edit" onClick={() => openEdit(announcement)}>Изменить</button>
                <button className="button button-warning" onClick={() => void toggle(announcement)}>
                  {announcement.isActive ? "Скрыть" : "Опубликовать"}
                </button>
                <button className="button button-danger" onClick={() => setDeleteTarget(announcement)}>Удалить</button>
              </div>
            </article>
          ))
        )}
      </div>

      {editorOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) closeEditor(); }}>
          <div className="editor-modal admin-form-modal announcement-editor" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={closeEditor} aria-label="Закрыть">×</button>
            <p className="eyebrow">{editing ? "Редактирование" : "Новое объявление"}</p>
            <h2>{editing ? "Изменить объявление" : "Объявление для команды"}</h2>
            <label>Заголовок
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={160} placeholder="Например, важная встреча в пятницу" autoFocus />
            </label>
            <label>Текст объявления
              <textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} maxLength={5000} rows={7} placeholder="Напиши подробности для участников" />
            </label>
            <div className="modal-actions">
              <button className="button button-muted" onClick={closeEditor}>Отмена</button>
              <button className="button button-primary" onClick={() => void save()} disabled={busy}>{busy ? "Сохраняем..." : editing ? "Сохранить" : "Опубликовать"}</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setDeleteTarget(null); }}>
          <div className="editor-modal admin-form-modal danger-modal" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setDeleteTarget(null)} aria-label="Закрыть">×</button>
            <p className="eyebrow eyebrow-danger">Удаление</p>
            <h2>Удалить объявление?</h2>
            <p className="modal-description">«{deleteTarget.title}» исчезнет у всех участников команды.</p>
            <div className="modal-actions">
              <button className="button button-muted" onClick={() => setDeleteTarget(null)}>Отмена</button>
              <button className="button button-danger" onClick={() => void remove()} disabled={busy}>{busy ? "Удаляем..." : "Удалить"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
