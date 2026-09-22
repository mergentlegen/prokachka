"use client";

import { useEffect, useRef } from "react";
import type { AuthUser } from "@/shared/domain/types";
import { isChangeTopic, userScope, type ChangeTopic } from "@/shared/domain/live-updates";
import { openLiveStream } from "@/frontend/shared/api/client";
import { invalidateData, localChangeEvent } from "@/frontend/shared/api/data-cache";
import { EventStreamParser } from "@/frontend/shared/lib/event-stream";

export function useLiveUpdates(user: AuthUser | null, onChange: (topics: ChangeTopic[]) => Promise<void>) {
  const callback = useRef(onChange);
  useEffect(() => { callback.current = onChange; }, [onChange]);
  const scope = userScope(user);
  useEffect(() => {
    if (!scope) return;
    let stopped = false;
    let controller: AbortController | undefined;
    let healthy = false;
    let busy = false;
    let attempts = 0;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<ChangeTopic>();
    const visible = () => !stopped && document.visibilityState !== "hidden";
    async function flush() {
      flushTimer = undefined;
      if (!visible() || busy || !pending.size) return;
      busy = true;
      const topics = [...pending];
      pending.clear();
      try { await callback.current(topics); }
      catch { /* The page keeps its last good state; fallback/reconnect retries. */ }
      finally {
        busy = false;
        if (visible() && pending.size) flushTimer = setTimeout(() => void flush(), 250);
      }
    }
    function queue(topics: ChangeTopic[], invalidate = true) {
      if (stopped || !topics.length) return;
      if (invalidate) invalidateData(topics);
      topics.forEach((topic) => pending.add(topic));
      if (!flushTimer && !busy && visible()) flushTimer = setTimeout(() => void flush(), 250);
    }
    function schedulePoll() {
      clearTimeout(pollTimer);
      if (visible()) pollTimer = setTimeout(() => { queue(["resync"]); schedulePoll(); }, healthy ? 120_000 : 30_000);
    }
    function resetWatchdog() {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller?.abort(), 45_000);
    }
    async function connect() {
      if (!visible() || controller) return;
      const connection = new AbortController();
      controller = connection;
      resetWatchdog();
      try {
        const response = await openLiveStream(connection.signal);
        if (response.status === 401) { queue(["session"]); throw new Error("Session expired"); }
        if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("Live updates unavailable");
        const parser = new EventStreamParser((event, raw) => {
          if (event === "ready") { healthy = true; attempts = 0; queue(["resync"]); schedulePoll(); }
          if (event === "degraded") {
            const wasHealthy = healthy;
            healthy = false;
            if (wasHealthy || !pollTimer) schedulePoll();
          }
          if (event === "change") {
            const payload: unknown = JSON.parse(raw);
            if (Array.isArray(payload)) queue(payload.filter(isChangeTopic));
          }
        });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done || stopped) break;
            resetWatchdog();
            parser.push(decoder.decode(value, { stream: true }));
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      } catch { /* Polling remains available when proxies or realtime are unavailable. */ }
      finally {
        clearTimeout(watchdog);
        connection.abort();
        if (controller === connection) controller = undefined;
        const wasHealthy = healthy;
        healthy = false;
        // Failed reconnect attempts must not postpone an already scheduled fallback.
        if (wasHealthy || !pollTimer) schedulePoll();
        if (visible()) {
          const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts++, 5)) + Math.random() * 500;
          reconnectTimer = setTimeout(() => void connect(), delay);
        }
      }
    }
    function visibilityChanged() {
      clearTimeout(reconnectTimer);
      clearTimeout(pollTimer);
      if (!visible()) { controller?.abort(); clearTimeout(flushTimer); flushTimer = undefined; return; }
      queue(["resync"]);
      schedulePoll();
      void connect();
    }
    function localChange(event: Event) {
      const topics: unknown = (event as CustomEvent).detail;
      if (Array.isArray(topics)) queue(topics.filter(isChangeTopic), false);
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("online", visibilityChanged);
    window.addEventListener(localChangeEvent, localChange);
    schedulePoll();
    void connect();
    return () => {
      stopped = true;
      controller?.abort();
      [flushTimer, reconnectTimer, pollTimer, watchdog].forEach(clearTimeout);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("online", visibilityChanged);
      window.removeEventListener(localChangeEvent, localChange);
    };
  }, [scope]);
}
