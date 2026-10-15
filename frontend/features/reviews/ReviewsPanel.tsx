"use client";
/* eslint-disable @next/next/no-img-element -- previews of photos picked on the device are local blob URLs */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Review, ReviewSummary } from "@/shared/domain/types";
import { deleteReview, loadReviews, saveOwnReview } from "@/frontend/shared/api/reviews-client";
import { prepareAnnouncementPhoto } from "@/frontend/features/announcements/prepare-photo";
import { AnnouncementGallery } from "@/frontend/features/announcements/AnnouncementGallery";
import { friendlyTime } from "@/frontend/features/announcements/announcement-view";
import { ANNOUNCEMENT_PHOTO_LIMIT } from "@/shared/domain/announcement-photos";
import { Avatar } from "@/frontend/shared/Avatar";
import { FormSheet } from "@/frontend/shared/FormSheet";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import { plural } from "@/frontend/shared/lib/plural";
import styles from "./ReviewsPanel.module.css";

const LONG_TEXT = 360;
type Filter = "all" | "photos";
type PendingPhoto = { id: string; file: File; url: string };

export function Stars({ value, size = "small" }: { value: number; size?: "small" | "large" }) {
  return <span className={`${styles.stars} ${size === "large" ? styles.starsLarge : ""}`} role="img" aria-label={`${value} из 5`}>
    {[1, 2, 3, 4, 5].map((star) => <span key={star} aria-hidden="true" className={star <= Math.round(value) ? styles.starOn : styles.starOff}>★</span>)}
  </span>;
}

export function SummaryCard({ summary }: { summary: ReviewSummary }) {
  const top = Math.max(1, ...Object.values(summary.stars));
  return <div className={styles.summary}>
    <div className={styles.average}>
      <strong>{summary.average.toFixed(1).replace(".", ",")}</strong>
      <Stars value={summary.average} size="large" />
      <span>{summary.count} {plural(summary.count, "отзыв", "отзыва", "отзывов")}</span>
    </div>
    <ul className={styles.bars} aria-label="Сколько каких оценок">
      {([5, 4, 3, 2, 1] as const).map((star) => <li key={star}>
        <span>{star} ★</span><i aria-hidden="true"><i style={{ width: `${(summary.stars[star] / top) * 100}%` }} /></i><b>{summary.stars[star]}</b>
      </li>)}
    </ul>
  </div>;
}

export function ReviewCard({ review, now, onEdit, onDelete }: { review: Review; now: number; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const long = review.body.length > LONG_TEXT;
  return <article className={`${styles.card} ${review.isMine ? styles.mine : ""}`}>
    <div className={styles.head}>
      <Avatar name={review.authorName} src={review.authorAvatarUrl} className={styles.avatar} />
      <span className={styles.byline}>
        <strong>{review.authorName}{review.isMine && <em>это вы</em>}</strong>
        <small>{[review.teamName && `«${review.teamName}»`, friendlyTime(review.createdAt, now), review.editedAt && "изменён"].filter(Boolean).join(" · ")}</small>
      </span>
    </div>
    <Stars value={review.rating} />
    <p className={`${styles.body} ${long && !open ? styles.clamped : ""}`}>{review.body}</p>
    {long && <button type="button" className={styles.more} onClick={() => setOpen(!open)}>{open ? "Свернуть" : "Читать полностью"}</button>}
    <AnnouncementGallery photos={review.photos} title={"Отзыв: " + review.authorName} />
    {(review.isMine || review.canDelete) && <div className={styles.actions}>
      {review.isMine && <button type="button" className={styles.action} onClick={onEdit}>Изменить</button>}
      <button type="button" className={`${styles.action} ${styles.danger}`} onClick={onDelete} aria-label={`Удалить отзыв: ${review.authorName}`}>Удалить</button>
    </div>}
  </article>;
}

function ReviewEditor({ review, onClose, onSaved }: { review?: Review; onClose: () => void; onSaved: (created: boolean) => void }) {
  const [rating, setRating] = useState(review?.rating || 0);
  const [body, setBody] = useState(review?.body || "");
  const [kept, setKept] = useState(review?.photos || []);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // Local previews are freed when the window closes.
  const pendingRef = useRef(pending);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => () => pendingRef.current.forEach((photo) => URL.revokeObjectURL(photo.url)), []);
  const text = body.trim();

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    if (selected.length + kept.length + pending.length > ANNOUNCEMENT_PHOTO_LIMIT) { setProblem(`Можно прикрепить не больше ${ANNOUNCEMENT_PHOTO_LIMIT} фотографий.`); return; }
    setPreparing(true); setProblem("");
    const next: PendingPhoto[] = [];
    try {
      for (const file of selected) {
        const prepared = await prepareAnnouncementPhoto(file);
        next.push({ id: crypto.randomUUID(), file: prepared, url: URL.createObjectURL(prepared) });
      }
      setPending((previous) => [...previous, ...next]);
    } catch (error) {
      next.forEach((photo) => URL.revokeObjectURL(photo.url));
      setProblem(error instanceof Error ? error.message : "Не удалось подготовить фотографию.");
    } finally { setPreparing(false); }
  }

  async function save() {
    if (!rating) { setProblem("Поставьте оценку от 1 до 5 звёзд."); return; }
    if (text.length < 10) { setProblem("Напишите хотя бы пару предложений: от 10 символов."); return; }
    setBusy(true); setProblem("");
    try {
      const { created } = await saveOwnReview({ rating, body: text, files: pending.map((photo) => photo.file), keepPhotoIds: review ? kept.map((photo) => photo.id) : undefined });
      onSaved(created);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Не удалось сохранить отзыв.");
    } finally { setBusy(false); }
  }

  return <FormSheet title={review ? "Мой отзыв" : "Новый отзыв"} submitLabel={review ? "Сохранить" : "Опубликовать"} busy={busy || preparing} busyLabel={preparing ? "Готовим фото…" : "Сохраняем…"}
    submitDisabled={!rating || text.length < 10} intro="Отзыв сразу увидят все участники клуба." onClose={onClose} onSubmit={() => void save()}>
    <fieldset className={styles.picker}>
      <legend>Оценка</legend>
      <div role="radiogroup" aria-label="Оценка">
        {[1, 2, 3, 4, 5].map((star) => <button key={star} type="button" role="radio" aria-checked={rating === star} aria-label={`${star} из 5`}
          className={star <= rating ? styles.pickOn : styles.pickOff} onClick={() => setRating(star)}>★</button>)}
      </div>
    </fieldset>
    <label>Отзыв<textarea id="review-body" value={body} maxLength={2000} rows={6} onChange={(event) => setBody(event.target.value)} placeholder="Расскажите о поездке, команде, клубе — о чём хотите" /></label>
    <p className={styles.counter}>{text.length} / 2000</p>
    <div className={styles.photos}>
      <span className={styles.photosTitle}>Фото <small>необязательно, до {ANNOUNCEMENT_PHOTO_LIMIT}</small></span>
      <div className={styles.thumbs}>
        {kept.map((photo) => <span key={photo.id} className={styles.thumb}><img src={photo.thumbnailUrl} alt="" /><button type="button" aria-label="Убрать фото" onClick={() => setKept(kept.filter((item) => item.id !== photo.id))}>×</button></span>)}
        {pending.map((photo) => <span key={photo.id} className={styles.thumb}><img src={photo.url} alt="" /><button type="button" aria-label="Убрать фото" onClick={() => { URL.revokeObjectURL(photo.url); setPending(pending.filter((item) => item.id !== photo.id)); }}>×</button></span>)}
        {kept.length + pending.length < ANNOUNCEMENT_PHOTO_LIMIT && <label className={styles.addPhoto}>
          <input id="review-photos" type="file" accept="image/*" multiple disabled={preparing || busy} onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} />
          <span aria-hidden="true">＋</span>Добавить
        </label>}
      </div>
    </div>
    {problem && <p className={styles.problem} role="alert">{problem}</p>}
  </FormSheet>;
}

/** The reviews feed: summary, the own review on top of the actions, everyone's reviews newest first. */
export function ReviewsPanel({ canWrite, onNotice, heading = true }: { canWrite: boolean; onNotice: (message: string) => void; /** The mentor panel has its own page title. */ heading?: boolean }) {
  const [data, setData] = useState<{ summary: ReviewSummary; reviews: Review[] } | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Review | "new" | null>(null);
  const [removing, setRemoving] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const reload = useCallback(async () => {
    try { setData(await loadReviews()); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить отзывы."); }
  }, []);
  useEffect(() => {
    let active = true;
    void loadReviews().then((loaded) => { if (active) setData(loaded); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Не удалось загрузить отзывы."); });
    return () => { active = false; };
  }, []);

  async function confirmDelete() {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteReview(removing.id);
      onNotice(removing.isMine ? "Ваш отзыв удалён." : "Отзыв удалён.");
      setRemoving(null);
      await reload();
    } catch (cause) { onNotice(cause instanceof Error ? cause.message : "Не удалось удалить отзыв."); }
    finally { setBusy(false); }
  }

  const mine = data?.reviews.find((review) => review.isMine);
  const shown = (data?.reviews || []).filter((review) => filter === "all" || review.photos.length > 0);
  return <section className={styles.panel} aria-label="Отзывы">
    {heading && <div className="section-heading"><div><p className="eyebrow">Клуб</p><h2>Отзывы</h2></div></div>}
    {error && !data ? <div className={styles.empty}><p>{error}</p><button type="button" className="button button-edit" onClick={() => void reload()}>Повторить</button></div>
      : !data ? <p className={styles.loading}>Загружаем отзывы…</p> : <>
      {data.summary.count > 0 && <SummaryCard summary={data.summary} />}
      {canWrite && <button type="button" className={styles.write} onClick={() => setEditing(mine || "new")}>{mine ? "Мой отзыв" : "Написать отзыв"}</button>}
      {data.reviews.some((review) => review.photos.length > 0) && <div className={styles.filters} role="group" aria-label="Показать отзывы">
        {([["all", "Все"], ["photos", "С фото"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? styles.filterOn : ""} onClick={() => setFilter(value)}>{label}</button>)}
      </div>}
      {shown.length === 0 ? <div className={styles.empty}><p>{data.reviews.length ? "Отзывов с фото пока нет." : "Отзывов пока нет. Будьте первым!"}</p></div>
        : <div className={styles.list}>{shown.map((review) => <ReviewCard key={review.id} review={review} now={now} onEdit={() => setEditing(review)} onDelete={() => setRemoving(review)} />)}</div>}
    </>}
    {editing && <ReviewEditor review={editing === "new" ? undefined : editing} onClose={() => setEditing(null)}
      onSaved={(created) => { setEditing(null); onNotice(created ? "Спасибо! Отзыв опубликован." : "Отзыв сохранён."); void reload(); }} />}
    {removing && <ConfirmModal title={removing.isMine ? "Удалить ваш отзыв?" : "Удалить отзыв?"} description={removing.isMine ? "Отзыв пропадёт у всех. Потом можно будет написать новый." : <>Отзыв {removing.authorName} пропадёт у всех. Это действие нельзя отменить.</>}
      confirmLabel="Удалить отзыв" busy={busy} onClose={() => { if (!busy) setRemoving(null); }} onConfirm={() => void confirmDelete()} />}
  </section>;
}
