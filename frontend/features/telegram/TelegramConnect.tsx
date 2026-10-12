"use client";

import { useState } from "react";

type TelegramConnectProps = {
  telegramId?: string;
  busy?: boolean;
  onLink: () => void;
  onRefresh: (silent?: boolean) => void | Promise<void>;
  /** Shown in the profile only: unlink, then the usual «Привязать» links it again (also to another Telegram). */
  onUnlink?: () => void | Promise<void>;
};

export function TelegramConnect({ telegramId, busy = false, onLink, onRefresh, onUnlink }: TelegramConnectProps) {
  const linked = Boolean(telegramId);
  const [asking, setAsking] = useState(false);

  if (linked && asking && onUnlink) return <section className="telegram-connect is-linked telegram-connect-confirm" role="group" aria-label="Отвязать Telegram">
    <div className="telegram-connect-copy">
      <strong>Отвязать Telegram?</strong>
      <p>Бот перестанет принимать твои ответы и присылать уведомления, пока ты не привяжешь Telegram снова — этот же или другой.</p>
    </div>
    <div className="telegram-connect-actions">
      <button type="button" className="button button-danger" disabled={busy} onClick={() => { void Promise.resolve(onUnlink()).finally(() => setAsking(false)); }}>{busy ? "Отвязываем..." : "Отвязать"}</button>
      <button type="button" className="telegram-connect-refresh" disabled={busy} onClick={() => setAsking(false)}>Отмена</button>
    </div>
  </section>;

  return <section className={"telegram-connect " + (linked ? "is-linked" : "is-unlinked")}>
    <div className="telegram-connect-icon">➤</div>
    <div className="telegram-connect-copy">
      <strong>{linked ? "Telegram привязан" : "Привяжите Telegram"}</strong>
      {!linked && <p>Для отправки ответов через бота.</p>}
    </div>
    <div className="telegram-connect-actions">
      {linked ? <span className="telegram-connect-status">Подключён</span> : <button type="button" className="button button-telegram" onClick={onLink} disabled={busy}>{busy ? "Открываем..." : "Привязать"}</button>}
      {!linked && <button type="button" className="telegram-connect-refresh" onClick={() => { void onRefresh(false); }} disabled={busy}>Проверить</button>}
      {linked && onUnlink && <button type="button" className="telegram-connect-refresh" onClick={() => setAsking(true)} disabled={busy}>Отвязать</button>}
    </div>
  </section>;
}
