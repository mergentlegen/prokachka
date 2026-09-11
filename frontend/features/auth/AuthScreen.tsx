"use client";

import { FormEvent, useEffect, useState } from "react";
import { clearDevSession } from "@/frontend/shared/api/client";
import type { AuthUser } from "@/shared/domain/types";

type AuthMode = "login" | "register";

export function AuthScreen({
  onAuthenticated,
  initialMode = "login",
}: {
  onAuthenticated: (user: AuthUser) => void;
  initialMode?: AuthMode;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);

    try {
      const inviteToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("invite") || undefined : undefined;
      const payload =
        mode === "login"
          ? { email, password }
          : { firstName, lastName, email, password, passwordConfirmation, inviteToken };

      const response = await fetch("/api/auth/" + (mode === "login" ? "login" : "register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.message || "Не удалось выполнить операцию.");
      }

      if (body.devAuthMode === true && typeof body.session === "string") {
        window.sessionStorage.setItem("incruises_dev_session", body.session);
      } else {
        clearDevSession();
      }

      onAuthenticated(body.user as AuthUser);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось выполнить операцию.",
      );
    } finally {
      setPending(false);
    }
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
  }

  return (
    <main className="login-shell">
      <div className="login-decor decor-one" />
      <div className="login-decor decor-two" />

      <div className="login-panel">
        <div className="login-brand"><img className="brand-logo" src="/brand/logo-light.svg" alt="Прокачка" /></div>

        <div className="login-copy">
          <p className="eyebrow">Твоя команда. Твой рост.</p>
          <h1>
            {mode === "login" ? (
              <>
                С возвращением, <em>команда</em>
              </>
            ) : (
              <>
                Создай свой <em>маршрут</em>
              </>
            )}
          </h1>
          <p>
            Практические задания, поддержка наставника и рейтинг, который
            показывает твой прогресс.
          </p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <div className="auth-tabs">
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => switchMode("login")}
            >
              Войти
            </button>
            <button
              type="button"
              className={mode === "register" ? "active" : ""}
              onClick={() => switchMode("register")}
            >
              Создать аккаунт
            </button>
          </div>

          {mode === "register" && (
            <div className="auth-name-grid">
              <div>
                <label htmlFor="auth-first-name">Имя</label>
                <div className="input-wrap">
                  <input
                    id="auth-first-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder="Мерген"
                    autoComplete="given-name"
                    autoFocus
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor="auth-last-name">Фамилия</label>
                <div className="input-wrap">
                  <input
                    id="auth-last-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder="Тлеген"
                    autoComplete="family-name"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="auth-email">Email</label>
            <div className="input-wrap">
            <span>@</span>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              autoComplete="email"
              autoFocus={mode === "login"}
              required
            />
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Пароль</label>
            <div className="input-wrap">
            <span>•</span>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="минимум 6 символов"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
            </div>
          </div>

          {mode === "register" && (
            <>
              <div className="auth-field">
                <label htmlFor="auth-password-confirmation">Повтори пароль</label>
                <div className="input-wrap">
                <span>•</span>
                <input
                  id="auth-password-confirmation"
                  type="password"
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  placeholder="введи пароль ещё раз"
                  autoComplete="new-password"
                  required
                />
                </div>
              </div>
            </>
          )}

          <button className="primary-button login-button" disabled={pending}>
            {pending
              ? "Проверяем..."
              : mode === "login"
                ? "Войти в прокачку"
                : "Создать аккаунт"}
            <span>↗</span>
          </button>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}          {mode === "login" && (
            <small>Вводи email и пароль, с которыми зарегистрировался.</small>
          )}
        </form>
      </div>

      <div className="login-footer">
        Команда растёт, когда растёшь ты <span>✦</span>
      </div>
    </main>
  );
}
