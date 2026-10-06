"use client";

import { useEffect, useRef } from "react";
import { isPageReload } from "@/frontend/shared/lib/page-state";

const KEY = "prokachka:scroll:";
const FRESH_MS = 30 * 60_000;

const keyFor = () => KEY + window.location.pathname + window.location.search;

/**
 * Remembers how far the page was scrolled when it is reloaded and returns there once the data is on screen.
 * The browser cannot do it by itself: right after a reload the content is not loaded yet, so the page is short.
 */
export function useRestoreScroll(ready: boolean) {
  const restored = useRef(false);
  useEffect(() => {
    const save = () => {
      try { sessionStorage.setItem(keyFor(), JSON.stringify({ y: Math.round(window.scrollY), at: Date.now() })); }
      catch { /* private mode or full storage: the page simply opens at the top */ }
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, []);
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    if (!isPageReload()) return;
    let saved: { y?: number; at?: number } | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(keyFor()) || "null"); sessionStorage.removeItem(keyFor()); }
    catch { return; }
    if (!saved?.y || !saved.at || Date.now() - saved.at > FRESH_MS) return;
    const y = saved.y;
    // Two frames: the freshly loaded lists and cards must be laid out before scrolling to them.
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" })));
  }, [ready]);
}
