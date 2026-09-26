"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthUser } from "@/shared/domain/types";
import { ApiError } from "@/frontend/shared/api/client";
import { loadWelcomeVideoSettings, removeWelcomeVideo, uploadWelcomeVideo, type VideoMetadata, type WelcomeVideo } from "@/frontend/shared/api/welcome-video-client";

const MAX_BYTES = 50 * 1024 * 1024;
const formatSize = (size: number) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} МБ` : `${Math.ceil(size / 1024)} КБ`;
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

export function WelcomeVideoSettingsPanel({ user }: { user: AuthUser }) {
  const [videos, setVideos] = useState<{ video: WelcomeVideo | null }>({ video: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function refresh() {
    setError("");
    try { setVideos(await loadWelcomeVideoSettings()); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "Не удалось загрузить настройки видео."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void Promise.resolve().then(refresh); }, []);
  if (loading) return <div className="welcome-video-settings-loading" role="status">Загружаем настройки…</div>;
  return <div className="welcome-video-settings">
    <div className="welcome-video-settings-intro"><span className="welcome-video-settings-icon" aria-hidden="true">▶</span><div><h2>Видео, которое увидит новый участник</h2><p>Ролик показывается один раз после одобрения заявки. Участнику назначается видео ближайшего наставника выше по его ветке, который загрузил ролик.</p></div></div>
    {error && <p className="welcome-video-settings-error" role="alert">{error} <button type="button" onClick={() => void refresh()}>Повторить</button></p>}
    <VideoSettingsCard title={user.role === "admin" ? "Видео верхнего наставника" : "Моё видео для моей ветки"} description={user.role === "admin" ? "Будет приветствием по умолчанию для команды. Видео наставников ниже по сети заменит его только для участников их веток." : "Его увидят новые участники ниже вас по сети. Соседние ветки его не увидят и продолжат использовать ролик своего наставника выше."} video={videos.video} onSaved={refresh} />
    <div className="welcome-video-specs"><strong>Рекомендации к файлу</strong><span>MP4 · любое разрешение и ориентация · до 3 минут · до 50 МБ</span><span>Для хорошего качества подойдёт 720p или сжатое 1080p (H.264, звук AAC).</span><small>Видео показывается целиком, без обрезки. Загрузка идёт в закрытое хранилище; учитывается фактический размер файла.</small><small>Если связь прервётся, загрузку можно повторить.</small></div>
  </div>;
}

function readMetadata(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      const metadata = { fileName: file.name, sizeBytes: file.size, durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight };
      if (!Number.isFinite(video.duration) || video.duration <= 0) return reject(new Error("Не удалось определить длительность видео."));
      if (video.videoWidth < 1 || video.videoHeight < 1 || video.videoWidth > 7680 || video.videoHeight > 7680) return reject(new Error("Не удалось определить разрешение видео. Попробуйте сохранить его в MP4 и загрузить снова."));
      if (video.duration > 180) return reject(new Error("Продолжительность видео не должна превышать 3 минуты."));
      resolve(metadata);
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось прочитать видео. Проверьте, что это исправный MP4-файл.")); };
    video.src = url;
  });
}

function VideoSettingsCard({ title, description, video, onSaved }: { title: string; description: string; video: WelcomeVideo | null; onSaved: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abortUpload = useRef<(() => void) | null>(null);
  useEffect(() => () => { if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function selectFile(candidate?: File) {
    setError(""); setFile(null); setMetadata(null); setPreviewUrl("");
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".mp4") || (candidate.type && candidate.type !== "video/mp4")) { setError("Поддерживается только видео в формате MP4."); return; }
    if (candidate.size > MAX_BYTES) { setError("На бесплатном тарифе Supabase размер видео не должен превышать 50 МБ."); return; }
    if (candidate.size < 1024) { setError("Этот видеофайл слишком маленький или пустой."); return; }
    try {
      const info = await readMetadata(candidate);
      setFile(candidate); setMetadata(info); setPreviewUrl(URL.createObjectURL(candidate));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось проверить файл."); }
  }

  async function upload() {
    if (!file || !metadata || busy) return;
    setBusy(true); setProgress(0); setError("");
    try {
      await uploadWelcomeVideo(file, metadata, setProgress, (abort) => { abortUpload.current = abort; });
      setFile(null); setMetadata(null); setPreviewUrl(""); await onSaved();
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "Загрузка отменена."
        ? "Загрузка отменена. Выберите файл и попробуйте снова."
        : cause instanceof ApiError || cause instanceof Error
          ? cause.message
          : "Не удалось загрузить видео. Проверьте настройки Storage в Supabase и попробуйте ещё раз.");
    }
    finally { setBusy(false); abortUpload.current = null; }
  }

  async function remove() {
    if (!video || busy || !window.confirm("Удалить это видео? Новые участники будут использовать ролик ближайшего наставника выше по сети, который его загрузил.")) return;
    setBusy(true); setError("");
    try { const result = await removeWelcomeVideo(); if (result.storageCleanupWarning) setError("Настройка удалена, но файл не удалось убрать из хранилища. Обратитесь к администратору."); await onSaved(); }
    catch { setError("Не удалось удалить видео. Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }

  return <section className="welcome-video-card">
    <div className="welcome-video-card-heading"><div><h3>{title}</h3><p>{description}</p></div>{video && <span className="welcome-video-ready">Настроено</span>}</div>
    {video && <div className="welcome-video-existing"><video src={video.url} controls playsInline preload="metadata" aria-label={title} /><div className="welcome-video-file-meta"><strong>{video.fileName}</strong><span>{formatSize(video.sizeBytes)} · {formatDuration(video.durationSeconds)} · {video.width}×{video.height}</span></div></div>}
    {previewUrl && metadata && <div className="welcome-video-preview"><video src={previewUrl} controls playsInline preload="metadata" aria-label="Предпросмотр выбранного видео" /><p>Проверьте видео перед публикацией: {formatSize(metadata.sizeBytes)} · {formatDuration(metadata.durationSeconds)} · {metadata.width}×{metadata.height}</p></div>}
    <div className="welcome-video-actions">
      <label className={`welcome-video-pick ${busy ? "is-disabled" : ""}`}>
        <input type="file" accept="video/mp4,.mp4" disabled={busy} onChange={(event) => { void selectFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        {video ? "Выбрать другое видео" : "Выбрать MP4-видео"}
      </label>
      {file && <button type="button" className="primary-button" disabled={busy} onClick={() => void upload()}>{busy ? "Загружаем…" : "Загрузить видео"}</button>}
      {video && <button type="button" className="welcome-video-delete" disabled={busy} onClick={() => void remove()}>Удалить</button>}
      {busy && <button type="button" className="welcome-video-cancel" onClick={() => abortUpload.current?.()}>Отменить</button>}
    </div>
    {busy && <div className="welcome-video-progress" role="status"><div><span>Загрузка видео</span><strong>{progress}%</strong></div><progress max="100" value={progress} /></div>}
    {error && <p className="welcome-video-settings-error" role="alert">{error}</p>}
  </section>;
}
