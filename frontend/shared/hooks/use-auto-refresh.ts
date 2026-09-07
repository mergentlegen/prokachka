"use client";

import { useEffect, useRef } from "react";

type AutoRefreshOptions = {
  enabled?: boolean;
  intervalMs?: number;
};

export function useAutoRefresh(refresh: () => Promise<void>, options: AutoRefreshOptions = {}) {
  const { enabled = true, intervalMs = 15000 } = options;
  const refreshRef = useRef(refresh);
  const inFlightRef = useRef(false);
  const lastRunRef = useRef(0);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    const run = async () => {
      if (disposed || document.visibilityState !== "visible" || inFlightRef.current) return;
      const now = Date.now();
      if (now - lastRunRef.current < 4000) return;
      lastRunRef.current = now;
      inFlightRef.current = true;
      try {
        await refreshRef.current();
      } finally {
        inFlightRef.current = false;
      }
    };

    const interval = window.setInterval(() => { void run(); }, intervalMs);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void run(); };
    const onFocus = () => { void run(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, intervalMs]);
}