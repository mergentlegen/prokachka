#!/usr/bin/env bash
set -Eeuo pipefail
# Installed once at /usr/local/bin/prokachka-start. Config contains paths, not secrets.
# shellcheck disable=SC1091
source /etc/prokachka-deploy.conf
if [[ -L "$APP_ROOT/current" ]]; then
  cd "$(readlink -f "$APP_ROOT/current")"
  exec "$NODE_BIN" scripts/start-release.cjs "$APP_ENV_FILE" "$APP_PORT"
fi
# First-deploy fallback preserves the existing application checkout.
cd "$LEGACY_APP_PATH"
export NODE_ENV=production
exec "$NODE_BIN" --env-file="$APP_ENV_FILE" node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port "$APP_PORT"
