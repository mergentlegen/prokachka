#!/usr/bin/env bash
# Usage from the project folder (Windows cmd):
#   scp scripts\prokachka-monitor.sh scripts\install-monitor.sh prokachka-vps:/tmp/
#   ssh -t prokachka-vps "sudo bash /tmp/install-monitor.sh"
# One-time setup of Prokachka monitoring and log limits. Run with sudo. Safe to re-run.
set -euo pipefail
BACKUP=/root/backup-2026-10/monitor
mkdir -p "$BACKUP"

echo "== 1. Monitor script, config and timer"
install -m 0755 -o root -g root /tmp/prokachka-monitor.sh /usr/local/bin/prokachka-monitor
printf 'ALERT_CHAT_ID=1096955748\n' > /etc/prokachka-monitor.conf
chown root:prokachka /etc/prokachka-monitor.conf; chmod 0640 /etc/prokachka-monitor.conf
cat > /etc/systemd/system/prokachka-monitor.service <<'UNIT'
[Unit]
Description=Prokachka health monitor (Telegram alerts)
After=network-online.target

[Service]
Type=oneshot
User=prokachka
Group=prokachka
EnvironmentFile=/etc/prokachka/prokachka.env
EnvironmentFile=/etc/prokachka-monitor.conf
StateDirectory=prokachka-monitor
ExecStart=/usr/local/bin/prokachka-monitor
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
UNIT
cat > /etc/systemd/system/prokachka-monitor.timer <<'UNIT'
[Unit]
Description=Run the Prokachka health monitor every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UNIT

echo "== 2. A normal stop during deploys is not an error"
mkdir -p /etc/systemd/system/prokachka.service.d
printf '[Service]\nSuccessExitStatus=143\n' > /etc/systemd/system/prokachka.service.d/clean-stop.conf

echo "== 3. System journal limit"
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=500M\n' > /etc/systemd/journald.conf.d/prokachka.conf
systemctl restart systemd-journald

echo "== 4. Rotation of the Telegram delivery log"
cat > /etc/logrotate.d/prokachka <<'ROT'
/var/log/prokachka/*.log {
	weekly
	rotate 8
	compress
	delaycompress
	missingok
	notifempty
	copytruncate
	su prokachka prokachka
}
ROT
logrotate -d /etc/logrotate.d/prokachka >/dev/null 2>&1 && echo "logrotate config ok"

echo "== 5. Request time in the nginx access log"
if ! grep -q 'log_format prokachka' /etc/nginx/nginx.conf; then
  cp -a /etc/nginx/nginx.conf "$BACKUP/nginx.conf.before-monitor"
  # Same fields as the default "combined" format, plus request and upstream time at the end.
  sed -i 's#^\(\s*\)access_log /var/log/nginx/access.log;#\1log_format prokachka '"'"'$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" rt=$request_time urt=$upstream_response_time'"'"';\n\1access_log /var/log/nginx/access.log prokachka;#' /etc/nginx/nginx.conf
  if nginx -t 2>/dev/null; then systemctl reload nginx; echo "nginx reloaded"
  else cp -a "$BACKUP/nginx.conf.before-monitor" /etc/nginx/nginx.conf; echo "nginx check failed, restored the previous config"; fi
else echo "nginx already logs request time"; fi

echo "== 6. Start"
systemctl daemon-reload
systemctl enable --now prokachka-monitor.timer
systemctl start prokachka-monitor.service
systemctl --no-pager --lines=0 status prokachka-monitor.service | head -5
systemctl list-timers prokachka-monitor.timer --no-pager | head -3
echo "done"
