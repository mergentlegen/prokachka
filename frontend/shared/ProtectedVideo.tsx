"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { loadTaskVideo, reportTaskVideoProgress } from "@/frontend/shared/api/task-video-client";
import { formatVideoTime, VIDEO_AUTHOR_MARK, type TaskVideoView } from "@/shared/domain/task-video";
import styles from "./ProtectedVideo.module.css";

const REPORT_EVERY_MS = 10_000;

/** Where the viewer's name drifts to next: somewhere inside the frame, never under the controls. */
function nextSpot(seed: number) {
  const x = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
  const y = Math.abs(Math.sin(seed * 78.233) * 12543.1234) % 1;
  return { left: `${8 + x * 52}%`, top: `${10 + y * 62}%` };
}

/**
 * A task video that cannot be shared by link (short-lived address issued after login), carries the author's
 * mark and the viewer's name over the picture, and on the first viewing cannot be skipped forward.
 */
export function ProtectedVideo({ taskId, viewerName, trackProgress = true, onCompleted }: {
  taskId: string; viewerName?: string; trackProgress?: boolean; onCompleted?: () => void;
}) {
  const [video, setVideo] = useState<TaskVideoView | null>(null);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [watched, setWatched] = useState(0);
  const [completed, setCompleted] = useState(false);
  // "native": browser fullscreen of the whole frame; "pseudo": a fixed full-window frame where that is unavailable (iPhone).
  const [full, setFull] = useState<"none" | "native" | "pseudo">("none");
  const [spot, setSpot] = useState(() => nextSpot(1));
  // The frame takes the video's own shape: a phone video stands tall instead of shrinking into a wide box.
  const [ratio, setRatio] = useState(16 / 9);
  const element = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
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

  // The viewer's name moves every few seconds so it cannot be cropped out of a screen recording.
  useEffect(() => {
    let seed = 1;
    const timer = window.setInterval(() => setSpot(nextSpot(++seed)), 9_000);
    return () => window.clearInterval(timer);
  }, []);

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

  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement ? "native" : "none");
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const free = completed || !trackProgress;
  function onTime(event: SyntheticEvent<HTMLVideoElement>) {
    const current = event.currentTarget.currentTime;
    // Normal playback moves a fraction of a second per event; a bigger leap is a skip forward.
    if (!free && current > furthest.current + 1.5) { event.currentTarget.currentTime = furthest.current; return; }
    if (current > furthest.current) { furthest.current = current; setWatched(current); }
    setTime(current);
  }
  function seek(target: number) {
    const media = element.current;
    if (!media) return;
    media.currentTime = free ? target : Math.min(target, furthest.current);
  }
  function toggle() {
    const media = element.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => undefined); else media.pause();
  }
  function fullscreen() {
    const box = frame.current;
    if (!box) return;
    if (full === "native") { void document.exitFullscreen(); return; }
    if (full === "pseudo") { setFull("none"); return; }
    // The whole frame goes fullscreen, not the bare <video>, so the watermark stays visible.
    if (box.requestFullscreen) void box.requestFullscreen().catch(() => setFull("pseudo"));
    else setFull("pseudo");
  }
  function failed() {
    // An expired address: fetch a fresh one and continue from the same second, a few times at most.
    if (reloads.current >= 3) { setError("Видео не загружается. Проверьте интернет и откройте задание заново."); return; }
    reloads.current += 1;
    resumeAt.current = element.current?.currentTime || furthest.current;
    loadTaskVideo(taskId).then(apply).catch(fail);
  }

  if (error) return <div className={styles.notice} role="alert">{error}</div>;
  if (!video) return <div className={`${styles.frame} ${styles.loading}`} aria-busy="true"><span>Загружаем видео…</span></div>;
  if (!video.url) return <div className={styles.notice}>{video.status === "failed" ? `Видео не удалось обработать${video.error ? `: ${video.error}` : "."}` : "Видео обрабатывается — обычно это занимает несколько минут."}</div>;

  const total = duration || video.durationSeconds || 0;
  return <div className={styles.wrap}>
    <div ref={frame} className={`${styles.frame} ${full === "pseudo" ? styles.pseudoFull : ""}`} style={{ "--ratio": ratio } as CSSProperties} onContextMenu={(event) => event.preventDefault()}>
      <video ref={element} className={styles.video} src={video.url} playsInline preload="metadata" disablePictureInPicture disableRemotePlayback
        controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
        onClick={toggle} onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); void report(furthest.current); }}
        onEnded={(event) => { setPlaying(false); furthest.current = Math.max(furthest.current, event.currentTarget.duration); void report(furthest.current); }}
        onTimeUpdate={onTime} onSeeking={(event) => { if (!free && event.currentTarget.currentTime > furthest.current + 1.5) event.currentTarget.currentTime = furthest.current; }}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          if (event.currentTarget.videoWidth && event.currentTarget.videoHeight) setRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight);
          if (resumeAt.current !== null) { event.currentTarget.currentTime = resumeAt.current; resumeAt.current = null; void event.currentTarget.play().catch(() => undefined); }
        }}
        onError={failed} />
      <span className={styles.author} aria-hidden="true">{VIDEO_AUTHOR_MARK}</span>
      {viewerName && <span className={styles.viewer} style={spot as CSSProperties} aria-hidden="true">{viewerName}</span>}
      {!playing && <button type="button" className={styles.bigPlay} onClick={toggle} aria-label="Смотреть видео">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg></button>}
      <div className={styles.controls}>
        <button type="button" onClick={toggle} aria-label={playing ? "Пауза" : "Смотреть"}>
          {playing ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>
            : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>}
        </button>
        <div className={styles.track} style={{ "--watched": `${total ? (Math.min(watched, total) / total) * 100 : 0}%` } as CSSProperties}>
          <input type="range" min={0} max={total || 1} step={0.1} value={Math.min(time, total || 1)} onChange={(event) => seek(Number(event.target.value))}
            aria-label="Перемотка" aria-valuetext={`${formatVideoTime(time)} из ${formatVideoTime(total)}`} />
        </div>
        <span className={styles.time}>{formatVideoTime(time)} / {formatVideoTime(total)}</span>
        <button type="button" onClick={fullscreen} aria-label={full !== "none" ? "Свернуть" : "Во весь экран"}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {full !== "none" ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</svg>
        </button>
      </div>
    </div>
    {trackProgress && <p className={`${styles.status} ${completed ? styles.done : ""}`} role="status">
      {completed ? "✓ Видео просмотрено" : `Досмотрите видео до конца${total ? ` · осталось ${formatVideoTime(Math.max(0, total - watched))}` : ""}`}
    </p>}
  </div>;
}
