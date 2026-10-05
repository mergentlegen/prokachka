#!/usr/bin/env bash
# Usage from the project folder (Windows cmd):
#   scp scripts\install-video-processing.sh prokachka-vps:/tmp/
#   ssh -t prokachka-vps "sudo bash /tmp/install-video-processing.sh"
# One-time setup of task video compression. Run with sudo. Safe to re-run.
set -euo pipefail

echo "== 1. ffmpeg (video compression)"
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg
fi
ffmpeg -version | head -1

echo "== 2. Compression worker every minute (one video at a time, lowest priority)"
LINE='* * * * * /usr/bin/flock -n /var/lib/prokachka/task-video.lock /usr/bin/nice -n 19 /usr/bin/node --env-file=/etc/prokachka/prokachka.env /var/www/prokachka-deploy/current/scripts/process-task-videos.cjs >> /var/log/prokachka/task-videos.log 2>&1'
CURRENT=$(crontab -u prokachka -l 2>/dev/null || true)
if grep -q 'process-task-videos.cjs' <<<"$CURRENT"; then
  echo "already scheduled"
else
  printf '%s\n%s\n' "$CURRENT" "$LINE" | sed '/^$/d' | crontab -u prokachka -
  echo "scheduled"
fi
crontab -u prokachka -l | grep -c 'process-task-videos.cjs' | xargs echo "worker lines:"

echo "== 3. Room for temporary files"
df -h /tmp | tail -1
echo "done"
