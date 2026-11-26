"use client";
/* eslint-disable @next/next/no-img-element -- private Storage photos come as short-lived signed links */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import type { AnnouncementPhoto } from "@/shared/domain/types";
import { clampView, doubleTapView, endSpeed, FITTED, pinchView, pullFade, swipeResult, zoomAt, type PhotoView, type Point } from "./photo-zoom";
import styles from "./AnnouncementGallery.module.css";

type Gesture =
  | { kind: "swipe"; start: Point; at: number; axis: "x" | "y" | null; samples: { at: number; y: number }[] }
  | { kind: "pan"; start: Point; at: number; from: PhotoView }
  | { kind: "pinch"; middle: Point; distance: number; from: PhotoView };

// Each photo file is fetched once while it is on the screen, so «Сохранить» opens the phone's menu right on the tap
// (the phone allows its share menu only straight after a tap).
const photoFiles = new Map<string, Promise<File | null>>();
function photoFile(url: string, number: number) {
  let file = photoFiles.get(url);
  if (!file) {
    file = fetch(url).then((response) => response.ok ? response.blob() : Promise.reject(new Error("photo")))
      .then((blob) => new File([blob], `foto-${number + 1}.${blob.type === "image/webp" ? "webp" : "jpg"}`, { type: blob.type || "image/jpeg" }))
      .catch(() => { photoFiles.delete(url); return null; });
    photoFiles.set(url, file);
    while (photoFiles.size > 12) photoFiles.delete(photoFiles.keys().next().value!);
  }
  return file;
}

/** Opens a photo like the phone's gallery: pinch or double tap to zoom, swipe sideways to turn, swipe down to close, «Сохранить». */
export function PhotoViewer({ photos, index, title, onIndex, onClose }: {
  photos: AnnouncementPhoto[]; index: number; title: string; onIndex: (index: number) => void; onClose: () => void;
}) {
  const photo = photos[index];
  const [view, setView] = useState<PhotoView>(FITTED);
  const [drag, setDrag] = useState<Point>({ x: 0, y: 0 });
  const [moving, setMoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);
  const viewRef = useRef(view);
  const count = photos.length;
  function applyView(next: PhotoView) { viewRef.current = next; setView(next); }
  // Another photo always opens fitted.
  function show(next: number) { applyView(FITTED); setDrag({ x: 0, y: 0 }); onIndex(next); }
  const turn = (step: number) => show((index + step + count) % count);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (count > 1 && event.key === "ArrowRight") { viewRef.current = FITTED; setView(FITTED); onIndex((index + 1) % count); }
      if (count > 1 && event.key === "ArrowLeft") { viewRef.current = FITTED; setView(FITTED); onIndex((index - 1 + count) % count); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, index, onClose, onIndex]);

  useEffect(() => { void photoFile(photo.url, index); }, [photo.url, index]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const file = await photoFile(photo.url, index);
      const phone = window.matchMedia?.("(pointer: coarse)").matches;
      if (file && phone && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; }
        catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
      }
      if (file) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(file); link.download = file.name;
        document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
        return;
      }
      window.open(photo.url, "_blank", "noopener");
    } finally { setSaving(false); }
  }

  function measure() {
    const box = frameRef.current?.getBoundingClientRect();
    const frame = { width: box?.width ?? 0, height: box?.height ?? 0 };
    const toFrame = (x: number, y: number): Point => ({ x: x - (box?.left ?? 0) - frame.width / 2, y: y - (box?.top ?? 0) - frame.height / 2 });
    return { frame, toFrame, size: { width: photo.width, height: photo.height } };
  }

  function twoFingers() {
    const [a, b] = [...pointers.current.values()];
    return { middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  function begin(at = performance.now()) {
    if (pointers.current.size >= 2) {
      const { middle, distance } = twoFingers();
      gesture.current = { kind: "pinch", middle: measure().toFrame(middle.x, middle.y), distance, from: viewRef.current };
      setDrag({ x: 0, y: 0 });
    } else if (pointers.current.size === 1) {
      const start = [...pointers.current.values()][0];
      gesture.current = viewRef.current.scale > 1.01 ? { kind: "pan", start, at, from: viewRef.current } : { kind: "swipe", start, at, axis: null, samples: [{ at, y: start.y }] };
    } else gesture.current = null;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setMoving(true);
    begin();
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current) return;
    const { frame, toFrame, size } = measure();
    if (current.kind === "pinch" && pointers.current.size >= 2) {
      const { middle, distance } = twoFingers();
      applyView(pinchView(current.from, current.middle, current.distance, toFrame(middle.x, middle.y), distance, frame, size));
    } else if (current.kind === "pan") {
      applyView(clampView({ scale: current.from.scale, offset: { x: current.from.offset.x + event.clientX - current.start.x, y: current.from.offset.y + event.clientY - current.start.y } }, frame, size));
    } else if (current.kind === "swipe") {
      const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
      current.samples.push({ at: performance.now(), y: event.clientY });
      if (current.samples.length > 30) current.samples.shift();
      if (!current.axis && Math.hypot(dx, dy) > 8) current.axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
      if (current.axis === "y") setDrag({ x: 0, y: dy > 0 ? dy : dy * 0.2 });
      else if (current.axis === "x" && count > 1) setDrag({ x: dx, y: 0 });
    }
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    if (current?.kind === "pinch") {
      if (viewRef.current.scale < 1.05) applyView(FITTED);
      lastTap.current = null;
      begin(); // one finger left on a zoomed photo keeps moving it
      if (!pointers.current.size) setMoving(false);
      return;
    }
    if (pointers.current.size) return;
    setMoving(false);
    gesture.current = null;
    if (!current) return;
    const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
    const now = performance.now();
    const tap = Math.hypot(dx, dy) < 10 && now - current.at < 300 && event.type === "pointerup";
    if (tap) {
      const point = { x: event.clientX, y: event.clientY };
      const previous = lastTap.current;
      if (previous && now - previous.at < 320 && Math.hypot(point.x - previous.point.x, point.y - previous.point.y) < 40) {
        const { frame, toFrame, size } = measure();
        applyView(doubleTapView(viewRef.current, toFrame(point.x, point.y), frame, size));
        lastTap.current = null;
      } else lastTap.current = { at: now, point };
      setDrag({ x: 0, y: 0 });
      return;
    }
    lastTap.current = null;
    if (current.kind !== "swipe") return;
    const result = swipeResult(dx, dy, endSpeed([...current.samples, { at: now, y: event.clientY }]));
    setDrag({ x: 0, y: 0 });
    if (result === "close") onClose();
    else if (count > 1 && result === "next") turn(1);
    else if (count > 1 && result === "previous") turn(-1);
  }

  function onWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.deltaY) return;
    const { frame, toFrame, size } = measure();
    applyView(zoomAt(viewRef.current, viewRef.current.scale * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)), toFrame(event.clientX, event.clientY), frame, size));
  }

  const zoomed = view.scale > 1.01;
  const picture: CSSProperties = {
    transform: `translate3d(${view.offset.x + drag.x}px, ${view.offset.y + drag.y}px, 0) scale(${view.scale})`,
    transition: moving ? "none" : undefined,
    cursor: zoomed ? (moving ? "grabbing" : "grab") : "zoom-in",
  };
  return <div className={styles.backdrop} role="presentation" data-no-pull style={{ "--fade": pullFade(drag.y) } as CSSProperties}>
    <div className={styles.viewer} role="dialog" aria-modal="true" aria-label={`${title}, фотография ${index + 1} из ${count}`}>
      <div className={styles.toolbar} style={{ opacity: drag.y > 0 ? pullFade(drag.y * 2) : undefined }}>
        <span>{index + 1} / {count}</span>
        <div className={styles.actions}>
          <button type="button" className={styles.save} onClick={() => void save()} disabled={saving} aria-label="Сохранить фотографию">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" /></svg>Сохранить
          </button>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="Закрыть фотографию">×</button>
        </div>
      </div>
      <div className={styles.stage} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
        onWheel={onWheel}>
        <div ref={frameRef} className={styles.full}>
          <img src={photo.url} alt={`${title}, фото ${index + 1}`} style={picture} draggable={false} />
        </div>
      </div>
      {count > 1 && !zoomed && <>
        <button type="button" className={`${styles.arrow} ${styles.previous}`} onClick={() => turn(-1)} aria-label="Предыдущая фотография">‹</button>
        <button type="button" className={`${styles.arrow} ${styles.next}`} onClick={() => turn(1)} aria-label="Следующая фотография">›</button>
      </>}
    </div>
  </div>;
}
