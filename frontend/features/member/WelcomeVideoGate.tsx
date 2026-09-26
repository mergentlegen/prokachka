"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthUser } from "@/shared/domain/types";
import { ApiError } from "@/frontend/shared/api/client";
import { completeWelcomeVideo, loadWelcomeVideo, type WelcomeVideo } from "@/frontend/shared/api/welcome-video-client";

export function WelcomeVideoGate({ user }: { user: AuthUser }) {
  const [video, setVideo] = useState<WelcomeVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLElement>(null);

  async function check() {
    setLoading(true);
    setError("");
    try {
      const result = await loadWelcomeVideo();
      setVideo(result.video || null);
      setVisible(Boolean(result.required && result.video));
      setEnded(false);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401 ? "Сессия завершилась. Обновите страницу и войдите снова." : "Не удалось проверить приветственное видео. Проверьте соединение и повторите попытку.");
      setVisible(true);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!user.teamId || user.role === "ceo") return;
    void Promise.resolve().then(check);
    // Onboarding status is server-owned; reload only when the authenticated team identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, user.teamId]);

  useEffect(() => {
    if (!visible) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => player.current?.focus(), 0);
    function preventEscape(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
      if (event.key === "Tab" && dialog.current) {
        const focusable = [...dialog.current.querySelectorAll<HTMLElement>("video[tabindex], button:not([disabled])")];
        if (!focusable.length) { event.preventDefault(); return; }
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    }
    window.addEventListener("keydown", preventEscape, true);
    return () => { window.clearTimeout(focusTimer); document.body.style.overflow = oldOverflow; window.removeEventListener("keydown", preventEscape, true); };
  }, [visible]);

  async function continueToCabinet() {
    if (!ended || saving) return;
    setSaving(true);
    setError("");
    try { await completeWelcomeVideo(); setVisible(false); }
    catch { setError("Не удалось сохранить просмотр. Нажмите кнопку ещё раз — повторно смотреть видео не нужно."); }
    finally { setSaving(false); }
  }

  if (!visible) return null;
  return <div className="welcome-video-backdrop">
    <section ref={dialog} className="welcome-video-dialog" role="dialog" aria-modal="true" aria-labelledby="welcome-video-title" aria-describedby="welcome-video-description">
      <div className="welcome-video-copy"><span className="welcome-video-kicker">ПЕРВЫЙ ВХОД В КАБИНЕТ</span>
        <h2 id="welcome-video-title">Добро пожаловать в команду!</h2>
        <p id="welcome-video-description">Посмотри короткое приветственное видео — после просмотра кабинет будет открыт.</p>
      </div>
      {loading ? <div className="welcome-video-loading" role="status"><span className="welcome-video-spinner" />Проверяем видео для твоей команды…</div> : video ? <div className="welcome-video-player-wrap">
        <video ref={player} key={video.url} className="welcome-video-player" src={video.url} controls playsInline preload="metadata" onEnded={() => setEnded(true)} onError={() => setError("Видео не удалось воспроизвести. Проверьте интернет и попробуйте загрузить его снова.")} aria-label="Приветственное видео команды" />
        <p className="welcome-video-note">Приветствие от наставника твоей ветки · {Math.ceil(video.durationSeconds / 60)} мин</p>
      </div> : null}
      {error && <p className="welcome-video-error" role="alert">{error}</p>}
      {video && ended && <button type="button" className="primary-button welcome-video-continue" onClick={() => void continueToCabinet()} disabled={saving}>{saving ? "Сохраняем просмотр…" : "Перейти в кабинет"}<span aria-hidden="true">→</span></button>}
      {error && !video && <button type="button" className="welcome-video-retry" onClick={() => void check()}>Проверить ещё раз</button>}
      {video && error && <button type="button" className="welcome-video-retry" onClick={() => void check()}>Повторить загрузку видео</button>}
    </section>
  </div>;
}
