"use client";
/* eslint-disable @next/next/no-img-element -- The crop preview displays a local Blob URL. */

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AuthUser } from "@/shared/domain/types";
import { profileNames, validateProfileNames } from "@/shared/domain/profile";
import { Avatar } from "@/frontend/shared/Avatar";
import { ApiError, refreshAuthSession } from "@/frontend/shared/api/client";
import { updateProfile } from "@/frontend/shared/api/profile-client";
import { cropRegion, initialCrop, loadAvatarImage, prepareAvatar, type AvatarCrop, type AvatarImage } from "./avatar-image";
import styles from "./ProfileEditor.module.css";

export function ProfileEditor({ user, onSaved, onCancel, onBusyChange }: {
  user: AuthUser; onSaved: (user: AuthUser) => void; onCancel: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [original] = useState(() => profileNames(user));
  const [firstName, setFirstName] = useState(original.firstName);
  const [lastName, setLastName] = useState(original.lastName);
  const [version, setVersion] = useState(user.profileVersion || "");
  const [image, setImage] = useState<AvatarImage | null>(null);
  const [crop, setCrop] = useState<AvatarCrop>(initialCrop);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const dirty = firstName.trim() !== original.firstName || lastName.trim() !== original.lastName || Boolean(image) || remove;
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  useEffect(() => () => { selection.current++; }, []);

  async function selectFile(file: File) {
    const ticket = ++selection.current;
    setImageBusy(true); setError("");
    try {
      const selected = await loadAvatarImage(file);
      if (selection.current !== ticket) { URL.revokeObjectURL(selected.url); return; }
      setImage(selected); setCrop(initialCrop); setRemove(false);
    } catch (caught) { if (selection.current === ticket) setError(caught instanceof Error ? caught.message : "Не удалось открыть фото."); }
    finally { if (selection.current === ticket) setImageBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || imageBusy || !dirty) return;
    const names = validateProfileNames(firstName, lastName);
    if ("error" in names) { setError(names.error); return; }
    setBusy(true); onBusyChange?.(true); setError(""); setConflict(false);
    try {
      const avatar = image ? await prepareAvatar(image, crop) : undefined;
      const updated = await updateProfile({ ...names, expectedVersion: version, avatarAction: image ? "replace" : remove ? "remove" : "keep", avatar });
      onSaved(updated);
    } catch (caught) {
      setConflict(caught instanceof ApiError && caught.status === 409);
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить профиль.");
    } finally { setBusy(false); onBusyChange?.(false); }
  }

  async function reloadVersion() {
    setBusy(true); onBusyChange?.(true);
    try {
      const current = await refreshAuthSession();
      setVersion(current.profileVersion || ""); setConflict(false);
      setError("Данные обновлены. Ваши изменения сохранены в форме — проверьте их и нажмите «Сохранить изменения».");
    } catch { setError("Не удалось обновить данные. Попробуйте ещё раз."); }
    finally { setBusy(false); onBusyChange?.(false); }
  }

  return <form className={styles.form} onSubmit={(event) => void save(event)} aria-busy={busy || imageBusy}>
    <section className={styles.photoSection} aria-label="Фотография профиля">
      <div className={styles.photoHeading}><div><h3>Фотография профиля</h3><p>Её увидят участники команды в рейтинге и других разделах.</p></div>{!image && <Avatar name={`${firstName} ${lastName}`} src={remove ? undefined : user.avatarUrl} className={styles.previewAvatar} eager />}</div>
      {image && <AvatarCropper image={image} crop={crop} onChange={setCrop} disabled={busy} />}
      <input ref={input} className={styles.fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Выбрать фотографию профиля" disabled={busy || imageBusy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void selectFile(file); }} />
      <div className={styles.photoActions}>
        <button type="button" className="button button-edit" disabled={busy || imageBusy} onClick={() => input.current?.click()}>{imageBusy ? "Открываем фото…" : image || user.avatarUrl ? "Изменить фото" : "Добавить фото"}</button>
        {(image || user.avatarUrl) && !remove && <button type="button" className={styles.removeButton} disabled={busy || imageBusy} onClick={() => { setImage(null); setRemove(Boolean(user.avatarUrl)); setError(""); }}>Удалить фото</button>}
        {(image || remove) && <button type="button" className={styles.resetButton} disabled={busy || imageBusy} onClick={() => { setImage(null); setRemove(false); }}>Отменить изменение фото</button>}
      </div>
      <p className={styles.hint}>{remove ? "Фотография удалится после сохранения. Вместо неё будут отображаться ваши инициалы." : "JPG, PNG или WebP до 5 МБ. Размер фотографии подстроится автоматически."}</p>
    </section>
    <div className={styles.fields}>
      <label htmlFor="profile-first-name">Имя<input id="profile-first-name" autoComplete="given-name" value={firstName} maxLength={60} minLength={2} required disabled={busy} onChange={(event) => setFirstName(event.target.value)} /></label>
      <label htmlFor="profile-last-name">Фамилия<input id="profile-last-name" autoComplete="family-name" value={lastName} maxLength={80} minLength={2} required disabled={busy} onChange={(event) => setLastName(event.target.value)} /></label>
    </div>
    {user.login && <div className={styles.accountInfo}><span>{user.login.includes("@") ? "Почта аккаунта" : "Логин аккаунта"}</span><strong>{user.login}</strong></div>}
    {error && <div className={styles.error} role="alert"><p>{error}</p>{conflict && <button type="button" className="button button-edit" disabled={busy} onClick={() => void reloadVersion()}>Обновить данные</button>}</div>}
    <div className={styles.formActions}><button type="submit" className="button button-primary" disabled={busy || imageBusy || !dirty}>{busy ? "Сохраняем…" : "Сохранить изменения"}</button><button type="button" className="button button-edit" disabled={busy || imageBusy} onClick={onCancel}>Отмена</button></div>
  </form>;
}

function AvatarCropper({ image, crop, onChange, disabled }: { image: AvatarImage; crop: AvatarCrop; onChange: (crop: AvatarCrop) => void; disabled: boolean }) {
  const region = cropRegion(image.width, image.height, crop);
  const pointer = useRef<{ id: number; x: number; y: number; crop: AvatarCrop; width: number } | null>(null);
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return <div className={styles.cropper}>
    <div className={styles.cropArea} role="img" aria-label="Предпросмотр фотографии" onPointerDown={(event) => {
      if (disabled) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, crop, width: event.currentTarget.clientWidth };
    }} onPointerMove={(event) => {
      const start = pointer.current;
      if (!start || start.id !== event.pointerId || disabled) return;
      const box = cropRegion(image.width, image.height, start.crop);
      const dx = start.width * (image.width - box.side) / box.side, dy = start.width * (image.height - box.side) / box.side;
      onChange({ ...start.crop, x: dx > 0 ? clamp(start.crop.x - (event.clientX - start.x) / dx) : 0.5, y: dy > 0 ? clamp(start.crop.y - (event.clientY - start.y) / dy) : 0.5 });
    }} onPointerUp={() => { pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }}>
      <img src={image.url} alt="" draggable={false} style={{ width: `${image.width / region.side * 100}%`, height: `${image.height / region.side * 100}%`, left: `${-region.left / region.side * 100}%`, top: `${-region.top / region.side * 100}%` }} />
    </div>
    <div className={styles.cropControls}><p>Перемещайте фото, чтобы выбрать кадр.</p>
      <label>Масштаб<input type="range" min={1} max={3} step={0.01} value={crop.zoom} disabled={disabled} onChange={(event) => onChange({ ...crop, zoom: Number(event.target.value) })} /></label>
      {image.width > region.side && <label>Влево — вправо<input type="range" min={0} max={1} step={0.01} value={crop.x} disabled={disabled} onChange={(event) => onChange({ ...crop, x: Number(event.target.value) })} /></label>}
      {image.height > region.side && <label>Вверх — вниз<input type="range" min={0} max={1} step={0.01} value={crop.y} disabled={disabled} onChange={(event) => onChange({ ...crop, y: Number(event.target.value) })} /></label>}
    </div>
  </div>;
}
