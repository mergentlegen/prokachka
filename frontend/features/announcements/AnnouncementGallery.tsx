"use client";
/* eslint-disable @next/next/no-img-element -- private Storage photos are optimized into full and thumbnail variants on upload */

import { useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { AnnouncementPhoto } from "@/shared/domain/types";
import { PhotoViewer } from "./PhotoViewer";
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
  const opener = useRef<HTMLButtonElement | null>(null);

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
    {active !== null && photos[active] && typeof document !== "undefined" && createPortal(<PhotoViewer photos={photos} index={active} title={title}
      onIndex={setActive} onClose={() => { setActive(null); opener.current?.focus(); }} />, document.body)}
  </>;
}
