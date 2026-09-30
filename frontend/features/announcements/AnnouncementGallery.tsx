"use client";
/* eslint-disable @next/next/no-img-element -- private Storage photos are optimized into full and thumbnail variants on upload */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AnnouncementPhoto } from "@/shared/domain/types";
import styles from "./AnnouncementGallery.module.css";

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
    <div className={`${styles.grid} ${photos.length === 1 ? styles.single : ""}`} aria-label={`Фотографии объявления «${title}»`}>
      {photos.map((photo, index) => <button type="button" className={styles.tile} key={photo.id}
        aria-label={`Открыть фотографию ${index + 1} из ${photos.length}`} onClick={(event) => { opener.current = event.currentTarget; setActive(index); }}>
        <img src={photo.thumbnailUrl} alt={`${title}, фото ${index + 1}`} width={Math.max(photo.width, 1)} height={Math.max(photo.height, 1)} loading="lazy" decoding="async" />
        {index === 3 && photos.length > 4 && <span className={styles.more}>+{photos.length - 4}</span>}
      </button>)}
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
