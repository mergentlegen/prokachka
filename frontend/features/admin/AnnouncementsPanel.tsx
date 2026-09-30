"use client";
/* eslint-disable @next/next/no-img-element -- announcement photos are pre-optimized private Storage assets */

import { useState } from "react";
import { comparePublications } from "@/shared/domain/publication-order";
import { PinBadge, PinButton } from "@/frontend/shared/PublicationPin";
import { formatDateTime } from "@/frontend/shared/lib/format";
import { deleteAdminAnnouncement, saveAdminAnnouncementWithPhotos, updateAdminAnnouncement } from "@/frontend/shared/api/admin-client";
import type { Announcement } from "@/shared/domain/types";
import { ResourceCard } from "@/frontend/shared/ResourceCard";
import { prepareAnnouncementPhoto } from "@/frontend/features/announcements/prepare-photo";
import { ANNOUNCEMENT_PHOTO_LIMIT } from "@/shared/domain/announcement-photos";

type Draft = { title: string; content: string; resourceUrl: string };
type PendingPhoto = { id: string; file: File; url: string };
type Props = {
  announcements: Announcement[];
  actorId: string;
  canManageAll: boolean;
  onChange: (announcements: Announcement[]) => void;
  onError: (message: string) => void;
};

export function AnnouncementsPanel({ announcements, actorId, canManageAll, onChange, onError }: Props) {
  const [draft, setDraft] = useState<Draft>({ title: "", content: "", resourceUrl: "" });
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [keepPhotoIds, setKeepPhotoIds] = useState<string[]>([]);

  function clearPending() { pendingPhotos.forEach((photo) => URL.revokeObjectURL(photo.url)); setPendingPhotos([]); }

  function openCreate() {
    setEditing(null);
    clearPending(); setKeepPhotoIds([]);
    setDraft({ title: "", content: "", resourceUrl: "" });
    setEditorOpen(true);
  }

  function openEdit(announcement: Announcement) {
    setEditing(announcement);
    clearPending(); setKeepPhotoIds((announcement.photos || []).map((photo) => photo.id));
    setDraft({ title: announcement.title, content: announcement.content, resourceUrl: announcement.resourceUrl || "" });
    setEditorOpen(true);
  }

  function closeEditor() {
    if (!busy && !preparing) { clearPending(); setEditorOpen(false); }
  }

  async function selectPhotos(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    if (selected.length + keepPhotoIds.length + pendingPhotos.length > ANNOUNCEMENT_PHOTO_LIMIT) {
      onError(`Можно прикрепить не больше ${ANNOUNCEMENT_PHOTO_LIMIT} фотографий.`); return;
    }
    setPreparing(true); onError("");
    const next: PendingPhoto[] = [];
    try {
      for (const file of selected) {
        const prepared = await prepareAnnouncementPhoto(file);
        next.push({ id: crypto.randomUUID(), file: prepared, url: URL.createObjectURL(prepared) });
      }
      setPendingPhotos((previous) => [...previous, ...next]);
    } catch (error) {
      next.forEach((photo) => URL.revokeObjectURL(photo.url));
      onError(error instanceof Error ? error.message : "Не удалось подготовить фотографию.");
    } finally { setPreparing(false); }
  }

  async function save() {
    const title = draft.title.trim();
    const content = draft.content.trim();
    if (title.length < 2) return onError("Укажи заголовок объявления.");
    if (content.length < 2) return onError("Добавь текст объявления.");

    if (preparing) return;
    setBusy(true);
    try {
      if (editing) {
        const updated = await saveAdminAnnouncementWithPhotos({ id: editing.id, title, content, resourceUrl: draft.resourceUrl.trim() || null, files: pendingPhotos.map((photo) => photo.file), keepPhotoIds });
        onChange(announcements.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await saveAdminAnnouncementWithPhotos({ title, content, resourceUrl: draft.resourceUrl.trim() || null, files: pendingPhotos.map((photo) => photo.file) });
        onChange([...announcements, created]);
      }
      clearPending(); setKeepPhotoIds([]);
      setEditorOpen(false);
      setEditing(null);
      setDraft({ title: "", content: "", resourceUrl: "" });
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

  async function toggle(announcement: Announcement, pin = false) {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await updateAdminAnnouncement(announcement.id, pin ? { isPinned: !announcement.isPinned } : { isActive: !announcement.isActive });
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
          [...announcements].sort(comparePublications).map((announcement) => {
            const canManage = canManageAll || announcement.authorId === actorId;
            return <article className="announcement-admin-row" key={announcement.id}>
              <div className="announcement-admin-copy">
                <div className="announcement-admin-meta">
                  <span className={announcement.isActive ? "announcement-live" : "announcement-hidden"}>
                    {announcement.isActive ? "Опубликовано" : "Скрыто"}
                  </span>
                  <time>{formatDateTime(announcement.createdAt)}</time>
                </div>
                {announcement.isPinned && <PinBadge />}
                <h3>{announcement.title}</h3>
                <p>{announcement.content}</p>
                {!!announcement.photos?.length && <span className="announcement-photo-count">📷 {announcement.photos.length} фото</span>}
                {announcement.resourceUrl && <a className="admin-resource-link" href={announcement.resourceUrl} target="_blank" rel="noopener noreferrer">Открыть ссылку ↗</a>}
              </div>
              {canManage && <div className="announcement-admin-actions">
                <PinButton pinned={announcement.isPinned} title={announcement.title} disabled={busy} onClick={() => void toggle(announcement, true)} />
                <button className="button button-edit" disabled={busy} onClick={() => openEdit(announcement)}>Изменить</button>
                <button className="button button-warning" disabled={busy} onClick={() => void toggle(announcement)}>
                  {announcement.isActive ? "Скрыть" : "Опубликовать"}
                </button>
                <button className="button button-danger" disabled={busy} onClick={() => setDeleteTarget(announcement)}>Удалить</button>
              </div>}
            </article>
          })
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
            <label>Ссылка на материал <span className="field-hint">необязательно</span>
              <input type="url" value={draft.resourceUrl} onChange={(event) => setDraft({ ...draft, resourceUrl: event.target.value })} placeholder="https://zoom.us/..." />
            </label>
            <ResourceCard url={draft.resourceUrl} caption="Так участник увидит материал" />
            <div className="announcement-photo-editor">
              <strong>Фотографии <span className="field-hint">необязательно · до {ANNOUNCEMENT_PHOTO_LIMIT}</span></strong>
              <p>Выбери снимки с телефона или компьютера. Подойдут JPG, PNG, WebP, HEIC и HEIF до 25 МБ каждый. Сохраним их без обрезки и покажем участникам в галерее.</p>
              <label className="button button-edit announcement-photo-picker">{preparing ? "Подготавливаем фото…" : "+ Добавить фотографии"}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" multiple disabled={busy || preparing || keepPhotoIds.length + pendingPhotos.length >= ANNOUNCEMENT_PHOTO_LIMIT}
                  onChange={(event) => { void selectPhotos(event.currentTarget.files); event.currentTarget.value = ""; }} />
              </label>
              {(keepPhotoIds.length > 0 || pendingPhotos.length > 0) && <div className="announcement-photo-previews">
                {(editing?.photos || []).filter((photo) => keepPhotoIds.includes(photo.id)).map((photo) => <div className="announcement-photo-preview" key={photo.id}><img src={photo.thumbnailUrl} alt="Фото объявления" /><button type="button" disabled={busy || preparing} aria-label="Убрать фотографию" onClick={() => setKeepPhotoIds((ids) => ids.filter((id) => id !== photo.id))}>×</button></div>)}
                {pendingPhotos.map((photo) => <div className="announcement-photo-preview" key={photo.id}><img src={photo.url} alt="Новое фото объявления" /><button type="button" disabled={busy || preparing} aria-label="Убрать новую фотографию" onClick={() => { URL.revokeObjectURL(photo.url); setPendingPhotos((photos) => photos.filter((item) => item.id !== photo.id)); }}>×</button></div>)}
              </div>}
              <small>{keepPhotoIds.length + pendingPhotos.length} / {ANNOUNCEMENT_PHOTO_LIMIT}</small>
            </div>
            <div className="modal-actions">
              <button className="button button-muted" onClick={closeEditor}>Отмена</button>
              <button className="button button-primary" onClick={() => void save()} disabled={busy || preparing}>{preparing ? "Подготавливаем фото…" : busy ? "Сохраняем..." : editing ? "Сохранить" : "Опубликовать"}</button>
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
