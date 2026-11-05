const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

const secret = 's'.repeat(40);
const env = { '@/backend/config/env': { serverEnv: { telegramDeliverySecret: secret } } };

test('internal endpoints accept only the server secret', () => {
  const { isInternalRequest } = loadTs('backend/http/internal-auth.ts', env);
  const req = (header) => new Request('http://x.test', { headers: header ? { authorization: header } : {} });
  assert.equal(isInternalRequest(req()), false);
  assert.equal(isInternalRequest(req('Bearer wrong')), false);
  assert.equal(isInternalRequest(req('Bearer ' + secret)), true);
  const weak = loadTs('backend/http/internal-auth.ts', { '@/backend/config/env': { serverEnv: { telegramDeliverySecret: 'short' } } });
  assert.equal(weak.isInternalRequest(req('Bearer short')), false, 'a short secret disables the door');
});

test('monitor counts only sendable jobs and how long the oldest ready one waits', async () => {
  const now = Date.parse('2026-10-03T10:00:00Z');
  const calls = [];
  const db = { from() {
    const ops = []; calls.push(ops);
    const query = new Proxy({}, { get(_t, key) {
      if (key === 'then') return (resolve) => resolve(ops.some(([op]) => op === 'gte')
        ? { data: [], count: 2, error: null }
        : { data: [{ available_at: '2026-10-03T09:40:00Z' }], count: 7, error: null });
      return (...args) => { ops.push([key, ...args]); return query; };
    } });
    return query;
  } };
  const { monitorSnapshot } = loadTs('backend/services/monitor.service.ts', { '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db } });
  const result = await monitorSnapshot(now);
  assert.deepEqual(result.data.queue, { waiting: 7, oldestMinutes: 20, failing: 2 });
  assert.ok(calls.every((ops) => ops.some(([op, column]) => op === 'not' && column === 'users.telegram_id')), 'jobs nobody can receive are ignored');
  const broken = loadTs('backend/services/monitor.service.ts', { '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ from() {
    const q = new Proxy({}, { get(_t, key) { return key === 'then' ? (resolve) => resolve({ data: null, error: { code: 'x' } }) : () => q; } }); return q;
  } }) } });
  assert.ok('error' in await broken.monitorSnapshot(now));
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Runs the real monitor script with fake curl/systemctl/sleep; SITE_CODES are the answers of /api/health in order.
function runMonitor(t, siteCodes) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prokachka-monitor-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const bin = path.join(temp, 'bin');
  const state = path.join(temp, 'state');
  fs.mkdirSync(bin);
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(state, '.welcome'), '');
  const log = path.join(temp, 'calls.log');
  fs.writeFileSync(path.join(bin, 'systemctl'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/usr/bin/env bash\necho "sleep $1" >> "$CALL_LOG"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'openssl'), '#!/usr/bin/env bash\ncat > /dev/null\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
args="$*"; input=""
[[ "$args" == *"-K -"* ]] && input=$(cat)
if [[ "$input" == *api.telegram.org* ]]; then echo "telegram $args" >> "$CALL_LOG"; printf 200; exit 0; fi
if [[ "$input" == *internal/monitor* ]]; then printf '{"monitor":{"queue":{"waiting":0,"oldestMinutes":0}}}\n200'; exit 0; fi
if [[ "$args" == *api/health* ]]; then
  read -ra codes <<< "$SITE_CODES"; n=$(cat "$CALL_LOG.count" 2>/dev/null || echo 0); echo $((n + 1)) > "$CALL_LOG.count"
  printf '%s' "\${codes[$n]:-\${codes[-1]}}"; exit 0
fi
printf 000
`, { mode: 0o755 });
  execFileSync('bash', [path.resolve(__dirname, '../scripts/prokachka-monitor.sh')], { env: { ...process.env,
    PATH: bin + ':' + process.env.PATH, STATE_DIRECTORY: state, CALL_LOG: log, SITE_CODES: siteCodes,
    TELEGRAM_BOT_TOKEN: 'token', ALERT_CHAT_ID: '1', TELEGRAM_DELIVERY_SECRET: secret } });
  return { calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', siteAlert: fs.existsSync(path.join(state, 'site')) };
}

const linuxOnly = { skip: process.platform !== 'linux' };
test('monitor stays quiet when a deploy restart meets the check', linuxOnly, (t) => {
  const { calls, siteAlert } = runMonitor(t, '502 200');
  assert.match(calls, /^sleep 20$/m, 'a failed check is repeated after a pause');
  assert.doesNotMatch(calls, /telegram/, 'a short restart is not an outage');
  assert.equal(siteAlert, false);
});
test('monitor alerts when the site is still down on the second look', linuxOnly, (t) => {
  const { calls, siteAlert } = runMonitor(t, '502 502');
  assert.match(calls, /telegram .*сайт не открывается \(ответ сервера: 502\)/);
  assert.equal(siteAlert, true);
});
