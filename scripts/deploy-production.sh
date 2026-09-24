#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

# Called with the artifact from the SAME workflow run that passed all CI jobs.
release_id="${1:?release ID required}"
expected_checksum="${2:?SHA256 required}"
[[ "$release_id" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || exit 2
[[ "$expected_checksum" =~ ^[a-f0-9]{64}$ ]] || exit 2
config="${PROKACHKA_DEPLOY_CONFIG:-/etc/prokachka-deploy.conf}"
# shellcheck disable=SC1090
source "$config"
: "${APP_ROOT:?}" "${APP_ENV_FILE:?}" "${SERVICE_NAME:?}" "${NODE_BIN:?}" "${APP_PORT:?}" "${PREFLIGHT_PORT:?}" "${LEGACY_APP_PATH:?}"
[[ "$APP_ROOT" == /*/prokachka-deploy && "$(realpath -e "$APP_ROOT")" == "$APP_ROOT" ]] || exit 2
[[ "$SERVICE_NAME" =~ ^[a-zA-Z0-9_-]+\.service$ ]] || exit 2
[[ "$APP_PORT" =~ ^[0-9]+$ && "$PREFLIGHT_PORT" =~ ^[0-9]+$ && "$APP_PORT" != "$PREFLIGHT_PORT" ]] || exit 2
[[ -f "$APP_ENV_FILE" && -r "$APP_ENV_FILE" && -x "$NODE_BIN" ]] || exit 2
for directory in releases incoming; do
  [[ -d "$APP_ROOT/$directory" && ! -L "$APP_ROOT/$directory" ]] || exit 2
done
exec 9> "$APP_ROOT/deploy.lock"
flock -w 600 9 || { echo 'Another deployment is still running' >&2; exit 1; }

archive="$APP_ROOT/incoming/$release_id.tar.gz"
release_dir="$APP_ROOT/releases/$release_id"
[[ -f "$archive" && ! -L "$archive" && ! -e "$release_dir" ]] || exit 2
printf '%s  %s\n' "$expected_checksum" "$archive" | sha256sum --check --status
previous=''
if [[ -L "$APP_ROOT/current" ]]; then
  previous="$(readlink -f "$APP_ROOT/current")"
  [[ "$previous" == "$APP_ROOT/releases/"* && -f "$previous/release.json" ]] || exit 2
elif [[ -e "$APP_ROOT/current" ]]; then
  echo 'current must be a symlink, not a real directory' >&2
  exit 2
else
  # The first deployment can fall back to the existing Next.js installation.
  [[ -f "$LEGACY_APP_PATH/.next/BUILD_ID" && -f "$LEGACY_APP_PATH/node_modules/next/dist/bin/next" ]] || {
    echo 'The legacy installation is required for the first deployment rollback' >&2; exit 2;
  }
fi

candidate_pid=''
switched=0
restart() { sudo -n /usr/bin/systemctl restart "$SERVICE_NAME"; }
stop_candidate() {
  if [[ -n "$candidate_pid" ]]; then
    kill "$candidate_pid" 2>/dev/null || true
    wait "$candidate_pid" 2>/dev/null || true
    candidate_pid=''
  fi
}
activate() {
  ln -s "$1" "$APP_ROOT/.current-$release_id"
  mv -Tf "$APP_ROOT/.current-$release_id" "$APP_ROOT/current"
}
verify_previous() {
  if [[ -n "$previous" ]]; then
    local old_id
    old_id="$("$NODE_BIN" -p 'require(process.argv[1]).release' "$previous/release.json")"
    "$NODE_BIN" "$previous/scripts/smoke-test.cjs" "http://127.0.0.1:$APP_PORT" "$old_id"
  else
    # Legacy version predates /api/health; only an exact HTTP 200 counts.
    local code
    for _ in {1..30}; do
      code="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 \
        -H 'Host: prokachka.kz' "http://127.0.0.1:$APP_PORT/" || true)"
      [[ "$code" == 200 ]] && return 0
      sleep 1
    done
    return 1
  fi
}
finish() {
  local status=$?
  trap - EXIT
  stop_candidate
  if [[ -L "$APP_ROOT/.current-$release_id" ]]; then
    unlink "$APP_ROOT/.current-$release_id"
  fi
  if (( status != 0 && switched == 1 )); then
    echo 'Deployment failed; restoring the previous version' >&2
    if [[ -n "$previous" ]]; then
      activate "$previous" || { echo 'ROLLBACK FAILED: cannot restore symlink' >&2; exit 1; }
    else
      unlink "$APP_ROOT/current" || { echo 'ROLLBACK FAILED: cannot restore legacy mode' >&2; exit 1; }
    fi
    if restart && verify_previous; then
      echo 'Previous version restored and checked' >&2
    else
      echo 'ROLLBACK FAILED: inspect systemctl status and journalctl immediately' >&2
    fi
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

mkdir "$release_dir"
# Artifacts are produced by our trusted main build; never unpack a PR artifact here.
tar --extract --gzip --file "$archive" --directory "$release_dir" --no-same-owner --no-same-permissions
[[ "$("$NODE_BIN" -p 'require(process.argv[1]).release' "$release_dir/release.json")" == "$release_id" ]]
"$NODE_BIN" "$release_dir/scripts/start-release.cjs" "$APP_ENV_FILE" "$PREFLIGHT_PORT" --check
"$NODE_BIN" "$release_dir/scripts/start-release.cjs" "$APP_ENV_FILE" "$PREFLIGHT_PORT" > "$release_dir/preflight.log" 2>&1 9>&- &
candidate_pid=$!
"$NODE_BIN" "$release_dir/scripts/smoke-test.cjs" "http://127.0.0.1:$PREFLIGHT_PORT" "$release_id"
kill -0 "$candidate_pid" # Do not accept a response from a different process on this port.
stop_candidate

# Keep the last hashed assets available to browsers with an already-open page.
if [[ -n "$previous" && -d "$previous/.next/static" ]]; then
  cp -an "$previous/.next/static/." "$release_dir/.next/static/"
fi
switched=1
activate "$release_dir"
restart
"$NODE_BIN" "$release_dir/scripts/smoke-test.cjs" "http://127.0.0.1:$APP_PORT" "$release_id"
echo "Deployment is healthy: $release_id"
