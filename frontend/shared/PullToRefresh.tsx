"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./PullToRefresh.module.css";

const THRESHOLD = 72;
const MAX_PULL = 112;
const MIN_SPIN_MS = 600;

// Touch-only pull-to-refresh for the page scroll. It refreshes data in place instead of reloading the page,
// and stays out of the way when a sheet is open or the gesture starts inside a scrolled area.
export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> | void }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const refresh = useRef(onRefresh);
  useEffect(() => { refresh.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    if (!("ontouchstart" in window)) return;
    const root = document.documentElement;
    const previousOverscroll = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "contain"; // Replaces the browser's own full-page reload gesture.
    let startX = 0, startY = 0, distance = 0, tracking = false, running = false, armed = false;

    const blocked = (target: EventTarget | null) => {
      if (document.body.style.overflow === "hidden") return true;
      for (let node = target instanceof Element ? target : null; node && node !== document.body; node = node.parentElement) {
        if (node.scrollTop > 0 || node.hasAttribute("data-no-pull")) return true;
      }
      return false;
    };
    const reset = () => { distance = 0; armed = false; setPull(0); };
    const start = (event: TouchEvent) => {
      tracking = !running && event.touches.length === 1 && window.scrollY <= 0 && !blocked(event.target);
      if (!tracking) return;
      startX = event.touches[0].clientX; startY = event.touches[0].clientY;
    };
    const move = (event: TouchEvent) => {
      if (!tracking) return;
      const dx = event.touches[0].clientX - startX, dy = event.touches[0].clientY - startY;
      if (dy <= 0 || Math.abs(dx) > dy) {
        if (distance) reset();
        if (dy < -4 || Math.abs(dx) > 12) tracking = false;
        return;
      }
      distance = Math.min(MAX_PULL, dy * 0.45);
      if (!armed && distance >= THRESHOLD) { armed = true; navigator.vibrate?.(8); }
      if (armed && distance < THRESHOLD) armed = false;
      setPull(distance);
    };
    const end = () => {
      if (!tracking) return;
      tracking = false;
      if (distance < THRESHOLD) { reset(); return; }
      running = true; setBusy(true); setPull(THRESHOLD);
      const began = Date.now();
      Promise.resolve().then(() => refresh.current()).catch(() => undefined)
        .then(() => new Promise((resolve) => window.setTimeout(resolve, Math.max(0, MIN_SPIN_MS - (Date.now() - began)))))
        .finally(() => { running = false; setBusy(false); reset(); });
    };
    const options = { passive: true } as const;
    window.addEventListener("touchstart", start, options);
    window.addEventListener("touchmove", move, options);
    window.addEventListener("touchend", end, options);
    window.addEventListener("touchcancel", end, options);
    return () => {
      root.style.overscrollBehaviorY = previousOverscroll;
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);

  if (!pull && !busy) return null;
  const progress = Math.min(1, pull / THRESHOLD);
  return <div className={`${styles.indicator} ${busy ? styles.busy : ""} ${pull ? "" : styles.settling}`} style={{ "--pull": `${pull}px`, "--progress": progress } as CSSProperties} role="status" aria-live="polite">
    <span className={styles.circle}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v4.5h-4.5" />
      </svg>
    </span>
    <span className={styles.label}>{busy ? "Обновляем…" : progress >= 1 ? "Отпустите, чтобы обновить" : "Потяните, чтобы обновить"}</span>
  </div>;
}
