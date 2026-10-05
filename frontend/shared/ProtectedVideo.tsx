"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { loadTaskVideo, reportTaskVideoProgress } from "@/frontend/shared/api/task-video-client";
import { formatVideoTime, type TaskVideoView } from "@/shared/domain/task-video";
import styles from "./ProtectedVideo.module.css";

const REPORT_EVERY_MS = 10_000;

/**
 * A task video in the phone's own player (tap shows controls, fullscreen closes with a swipe), served from a
 * short-lived address issued after login. On the first viewing a skip forward returns to the furthest point
 * already watched, and the server keeps how far the participant got.
 */
export function ProtectedVideo({ taskId, trackProgress = true, onCompleted }: { taskId: string; trackProgress?: boolean; onCompleted?: () => void }) {
  const [video, setVideo] = useState<TaskVideoView | null>(null);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [watched, setWatched] = useState(0);
  const [duration, setDuration] = useState(0);
  const [completed, setCompleted] = useState(false);
  const element = useRef<HTMLVideoElement>(null);
  const furthest = useRef(0);
  const resumeAt = useRef<number | null>(null);
  const reloads = useRef(0);
  const sending = useRef(false);
  const announced = useRef(false);

  const apply = useCallback((next: TaskVideoView) => {
    setVideo(next); setError("");
    furthest.current = Math.max(furthest.current, next.watchedSeconds);
    setWatched(furthest.current); setCompleted((value) => value || next.completed);
  }, []);
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Не удалось открыть видео.");

  useEffect(() => {
    let active = true;
    loadTaskVideo(taskId).then((next) => { if (active) apply(next); }).catch((cause) => { if (active) fail(cause); });
    return () => { active = false; };
  }, [taskId, apply]);

  const report = useCallback(async (position: number) => {
    if (!trackProgress || sending.current) return;
    sending.current = true;
    try {
      const progress = await reportTaskVideoProgress(taskId, position);
      if (progress?.completed) {
        setCompleted(true);
        if (!announced.current) { announced.current = true; onCompleted?.(); }
      }
    } catch { /* the next report retries; watching is never interrupted */ }
    finally { sending.current = false; }
  }, [taskId, trackProgress, onCompleted]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => void report(furthest.current), REPORT_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [playing, report]);

  const free = completed || !trackProgress;
  // Normal playback moves a fraction of a second per event; a bigger leap past the watched part is a skip.
  function guard(event: SyntheticEvent<HTMLVideoElement>) {
    const media = event.currentTarget;
    if (!free && media.currentTime > furthest.current + 1.5) { media.currentTime = furthest.current; return; }
    if (media.currentTime > furthest.current) { furthest.current = media.currentTime; setWatched(media.currentTime); }
  }
  function failed() {
    // An expired address: fetch a fresh one and continue from the same second, a few times at most.
    if (reloads.current >= 3) { setError("Видео не загружается. Проверьте интернет и откройте задание заново."); return; }
    reloads.current += 1;
    resumeAt.current = element.current?.currentTime || furthest.current;
    loadTaskVideo(taskId).then(apply).catch(fail);
  }

  if (error) return <div className={styles.notice} role="alert">{error}</div>;
  if (!video) return <div className={`${styles.video} ${styles.loading}`} aria-busy="true">Загружаем видео…</div>;
  if (!video.url) return <div className={styles.notice}>{video.status === "failed" ? `Видео не удалось обработать${video.error ? `: ${video.error}` : "."}` : "Видео обрабатывается — обычно это занимает несколько минут."}</div>;

  const total = duration || video.durationSeconds || 0;
  return <div className={styles.wrap}>
    <video ref={element} className={styles.video} src={video.url} controls playsInline preload="metadata"
      controlsList="nodownload noremoteplayback noplaybackrate" disablePictureInPicture disableRemotePlayback
      onContextMenu={(event) => event.preventDefault()}
      onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); void report(furthest.current); }}
      onEnded={(event) => { setPlaying(false); furthest.current = Math.max(furthest.current, event.currentTarget.duration); void report(furthest.current); }}
      onTimeUpdate={guard} onSeeking={guard}
      onLoadedMetadata={(event) => {
        setDuration(event.currentTarget.duration || 0);
        if (resumeAt.current !== null) { event.currentTarget.currentTime = resumeAt.current; resumeAt.current = null; void event.currentTarget.play().catch(() => undefined); }
      }}
      onError={failed} />
    {trackProgress && <p className={`${styles.status} ${completed ? styles.done : ""}`} role="status">
      {completed ? "✓ Видео просмотрено" : `Досмотрите видео до конца${total ? ` · осталось ${formatVideoTime(Math.max(0, total - watched))}` : ""}`}
    </p>}
  </div>;
}
