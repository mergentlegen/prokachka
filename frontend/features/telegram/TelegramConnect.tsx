"use client";

import { useAutoRefresh } from "@/frontend/shared/hooks/use-auto-refresh";

type TelegramConnectProps = {
  telegramId?: string;
  busy?: boolean;
  onLink: () => void;
  onRefresh: (silent?: boolean) => void | Promise<void>;
};

export function TelegramConnect({ telegramId, busy = false, onLink, onRefresh }: TelegramConnectProps) {
  const linked = Boolean(telegramId);

  useAutoRefresh(async () => {
    if (!linked && !busy) await onRefresh(true);
  }, { enabled: !linked && !busy, intervalMs: 20000 });

  return <section className={"telegram-connect " + (linked ? "is-linked" : "is-unlinked")}>
    <div className="telegram-connect-icon">➤</div>
    <div className="telegram-connect-copy">
      <strong>{linked ? "Telegram привязан" : "Привяжите Telegram"}</strong>
      <p>{linked ? "Теперь можно отправлять работы через бота." : "Это нужно, чтобы система узнала именно ваш аккаунт."}</p>
    </div>
    <div className="telegram-connect-actions">
      {linked ? <span className="telegram-connect-status">Подключён</span> : <button type="button" className="button button-telegram" onClick={onLink} disabled={busy}>{busy ? "Открываем..." : "Привязать"}</button>}
      {!linked && <button type="button" className="telegram-connect-refresh" onClick={() => { void onRefresh(false); }} disabled={busy}>Проверить</button>}
    </div>
  </section>;
}