"use client";
/* eslint-disable @next/next/no-img-element -- private Storage photos are optimized into full and thumbnail variants on upload */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { AnnouncementPhoto } from "@/shared/domain/types";
import styles from "./AnnouncementGallery.module.css";

const VISIBLE_PHOTOS = 4;

/** Width/height of the photo, limited so extreme panoramas or long screenshots do not become thin strips. */
function photoRatio(photo: AnnouncementPhoto) {
  const ratio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 4 / 3;
  return Math.min(Math.max(ratio, 0.45), 3);
}

/** Fills each row until the photos are wide enough together (max three), so portraits share a row and landscapes pair up. */
function galleryRows(photos: AnnouncementPhoto[]) {
  const visible = photos.slice(0, VISIBLE_PHOTOS).map((photo, index) => ({ photo, index, ratio: photoRatio(photo) }));
  const rows: typeof visible[] = [];
  let row: typeof visible = [];
  for (const item of visible) {
    row.push(item);
    if (row.length === 3 || row.reduce((sum, entry) => sum + entry.ratio, 0) >= 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  return rows;
}

export function AnnouncementGallery({ photos, title }: { photos: AnnouncementPhoto[]; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const touchX = useRef<number | null>(null);
  const selected = active === null ? null : photos[active];
  const isOpen = active !== null;

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setActive(null);
      if (event.key === "ArrowRight") setActive((index) => index === null ? null : (index + 1) % photos.length);
      if (event.key === "ArrowLeft") setActive((index) => index === null ? null : (index - 1 + photos.length) % photos.length);
    }
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKey); opener.current?.focus(); };
  }, [isOpen, photos.length]);

  if (!photos.length) return null;
  return <>
    <div className={styles.gallery} aria-label={`Фотографии объявления «${title}»`}>
      {galleryRows(photos).map((row) => { const ratioSum = row.reduce((sum, item) => sum + item.ratio, 0); return <div className={`${styles.row} ${photos.length === 1 ? styles.single : ""}`} key={row[0].photo.id}
        style={{ "--ratio-sum": ratioSum, "--gaps": row.length - 1 } as CSSProperties}>
        {row.map(({ photo, index, ratio }) => <button type="button" className={styles.tile} key={photo.id} style={{ flexGrow: ratio / ratioSum, aspectRatio: String(ratio) }}
          aria-label={`Открыть фотографию ${index + 1} из ${photos.length}`} onClick={(event) => { opener.current = event.currentTarget; setActive(index); }}>
          <img src={photo.thumbnailUrl} alt={`${title}, фото ${index + 1}`} width={Math.max(photo.width, 1)} height={Math.max(photo.height, 1)} loading="lazy" decoding="async" />
          {index === VISIBLE_PHOTOS - 1 && photos.length > VISIBLE_PHOTOS && <span className={styles.more}>+{photos.length - VISIBLE_PHOTOS}</span>}
        </button>)}
      </div>; })}
    </div>
    {selected && typeof document !== "undefined" && createPortal(<div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActive(null); }}>
      <div className={styles.viewer} role="dialog" aria-modal="true" aria-label={`${title}, фотография ${active! + 1} из ${photos.length}`}
        onTouchStart={(event) => { touchX.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => { if (touchX.current === null || photos.length < 2) return; const distance = (event.changedTouches[0]?.clientX ?? touchX.current) - touchX.current; touchX.current = null; if (Math.abs(distance) > 45) setActive((index) => index === null ? null : (index + (distance < 0 ? 1 : photos.length - 1)) % photos.length); }}>
        <div className={styles.toolbar}><span>{active! + 1} / {photos.length}</span><button ref={closeRef} type="button" onClick={() => setActive(null)} aria-label="Закрыть фотографию">×</button></div>
        <div className={styles.full}><img src={selected.url} alt={`${title}, фото ${active! + 1}`} /></div>
        {photos.length > 1 && <><button type="button" className={`${styles.arrow} ${styles.previous}`} onClick={() => setActive((index) => index === null ? null : (index - 1 + photos.length) % photos.length)} aria-label="Предыдущая фотография">‹</button><button type="button" className={`${styles.arrow} ${styles.next}`} onClick={() => setActive((index) => index === null ? null : (index + 1) % photos.length)} aria-label="Следующая фотография">›</button></>}
      </div>
    </div>, document.body)}
  </>;
}
