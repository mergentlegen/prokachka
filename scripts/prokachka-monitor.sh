#!/usr/bin/env bash
# Prokachka health monitor. Runs every 5 minutes from prokachka-monitor.timer as the prokachka user.
# A failed check sends one Telegram message, a reminder every 3 hours while it stays failed,
# and "Восстановлено" once it recovers. Secrets travel through curl's stdin, never the command line.
set -uo pipefail

STATE="${STATE_DIRECTORY:-/var/lib/prokachka-monitor}"
SITE="https://prokachka.kz"
REMIND_SECONDS=$((3 * 3600))
now=$(date +%s)

send() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ALERT_CHAT_ID:-}" ] || return 1
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_BOT_TOKEN" \
    | curl -s -o /dev/null -w '%{http_code}' --max-time 15 -K - \
      --data-urlencode "chat_id=$ALERT_CHAT_ID" --data-urlencode "text=$1" | grep -q '^200$'
}

# report NAME FAILED(0|1) MESSAGE — the state file remembers when we last alerted and about what.
report() {
  local name=$1 failed=$2 message=$3 file="$STATE/$name"
  if [ "$failed" = 1 ]; then
    if [ ! -f "$file" ]; then
      send "🔴 Прокачка: $message" && printf '%s\n%s\n' "$now" "$message" > "$file"
    elif [ $((now - $(head -1 "$file"))) -ge "$REMIND_SECONDS" ]; then
      send "🔴 Всё ещё не исправлено: $message" && printf '%s\n%s\n' "$now" "$message" > "$file"
    fi
  elif [ -f "$file" ]; then
    send "✅ Прокачка, восстановлено: $(sed -n 2p "$file")" && rm -f "$file"
  fi
}

if [ ! -f "$STATE/.welcome" ]; then
  send "✅ Мониторинг Прокачки включён. Каждые 5 минут проверяю сайт, базу, очередь Telegram, диск, память и сертификат. Пишу сюда, только если что-то сломалось." \
    && touch "$STATE/.welcome"
fi

# 1. The application process.
if systemctl is-active --quiet prokachka; then report service 0 ""; else report service 1 "служба сайта остановлена"; fi

# 2. The site answers through nginx and HTTPS.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve prokachka.kz:443:127.0.0.1 "$SITE/api/health")
if [ "$code" = 200 ]; then report site 0 ""; else report site 1 "сайт не открывается (ответ сервера: $code)"; fi

# 3. Database and the Telegram queue. 404 means the check is not deployed yet: skip quietly.
body=$(printf 'url = "%s/api/internal/monitor"\nheader = "Authorization: Bearer %s"\n' "$SITE" "${TELEGRAM_DELIVERY_SECRET:-}" \
  | curl -s --max-time 20 --resolve prokachka.kz:443:127.0.0.1 -w '\n%{http_code}' -K -)
status=${body##*$'\n'}
json=${body%$'\n'*}
if [ "$status" = 200 ]; then
  report database 0 ""
  waiting=$(jq -r '.monitor.queue.waiting // 0' <<<"$json")
  oldest=$(jq -r '.monitor.queue.oldestMinutes // 0' <<<"$json")
  if [ "$oldest" -ge 15 ]; then report queue 1 "очередь Telegram стоит: ждут $waiting сообщ., самое старое готово к отправке $oldest мин назад"
  else report queue 0 ""; fi
elif [ "$status" != 404 ]; then
  report database 1 "база данных не отвечает на проверку (ответ: $status)"
fi

# 4. Disk and memory.
disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "${disk:-0}" -ge 85 ]; then report disk 1 "диск заполнен на ${disk}%"; else report disk 0 ""; fi
memory=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)
if [ "${memory:-9999}" -lt 150 ]; then report memory 1 "осталось мало памяти: ${memory} МБ"; else report memory 0 ""; fi

# 5. The HTTPS certificate (certbot renews it; this catches a renewal that silently failed).
end=$(echo | timeout 10 openssl s_client -connect 127.0.0.1:443 -servername prokachka.kz 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$end" ]; then
  days=$(( ($(date -d "$end" +%s) - now) / 86400 ))
  if [ "$days" -lt 14 ]; then report certificate 1 "сертификат HTTPS истекает через $days дн."; else report certificate 0 ""; fi
fi
exit 0
