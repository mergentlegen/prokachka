const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { validateRuntime } = require('../scripts/start-release.cjs');
const run = promisify(execFile);
const oldId = 'a'.repeat(40) + '-1-1';
const newId = 'b'.repeat(40) + '-2-1';
const metadata = {
  release: newId, platform: process.platform, arch: process.arch,
  nodeMajor: Number(process.versions.node.split('.')[0]),
  appUrl: 'https://prokachka.kz', supabaseUrl: 'https://example.supabase.co',
};
const config = {
  AUTH_SECRET: 'x'.repeat(32), AUTH_DEV_MODE: 'false', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  NEXT_PUBLIC_APP_URL: metadata.appUrl, NEXT_PUBLIC_SUPABASE_URL: metadata.supabaseUrl,
};

test('runtime rejects mismatched public configuration, dev auth and incompatible builds', () => {
  assert.doesNotThrow(() => validateRuntime(metadata, config));
  assert.throws(() => validateRuntime(metadata, { ...config, NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' }), /differs/);
  assert.throws(() => validateRuntime(metadata, { ...config, AUTH_DEV_MODE: 'true' }), /AUTH_DEV_MODE/);
  assert.throws(() => validateRuntime(metadata, { ...config, AUTH_SECRET: 'short' }), /AUTH_SECRET/);
  assert.throws(() => validateRuntime({ ...metadata, nodeMajor: 0 }, config), /Node.js/);
  assert.throws(() => validateRuntime({ ...metadata, arch: 'wrong-arch' }, config), /architecture/);
});

// Execute the actual Bash orchestration against disposable directories and fake
// process/service commands. Never contacts systemd, SSH, Supabase or production.
async function scenario(t, mode, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prokachka-deploy-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'prokachka-deploy');
  const previous = path.join(root, 'releases', oldId);
  const source = path.join(temp, 'source');
  const bin = path.join(temp, 'bin');
  for (const directory of [previous, source, bin, path.join(root, 'incoming')]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(source, 'release.json'), JSON.stringify({ ...metadata, release: newId }));
  fs.writeFileSync(path.join(previous, 'release.json'), JSON.stringify({ ...metadata, release: oldId }));
  const legacy = path.join(temp, 'legacy');
  if (options.legacy) {
    fs.mkdirSync(path.join(legacy, '.next'), { recursive: true });
    fs.mkdirSync(path.join(legacy, 'node_modules/next/dist/bin'), { recursive: true });
    fs.writeFileSync(path.join(legacy, '.next/BUILD_ID'), 'legacy');
    fs.writeFileSync(path.join(legacy, 'node_modules/next/dist/bin/next'), 'legacy');
  } else fs.symlinkSync(previous, path.join(root, 'current'));
  const envFile = path.join(temp, 'app.env');
  fs.writeFileSync(envFile, '');
  const configFile = path.join(temp, 'deploy.conf');
  fs.writeFileSync(configFile, `APP_ROOT='${root}'\nAPP_ENV_FILE='${envFile}'\nSERVICE_NAME=prokachka.service\nNODE_BIN='${bin}/node'\nAPP_PORT=3000\nPREFLIGHT_PORT=3100\nLEGACY_APP_PATH='${legacy}'\n`);
  fs.writeFileSync(path.join(bin, 'node'), `#!/usr/bin/env bash
set -eu
if [[ "$1" == '-p' ]]; then exec "$REAL_NODE" "$@"; fi
if [[ "$1" == *start-release.cjs ]]; then
  [[ "\${4:-}" == --check ]] && exit 0
  exec sleep 120
fi
if [[ "$1" == *smoke-test.cjs ]]; then
  echo "smoke $2 $3" >> "$COMMAND_LOG"
  [[ "$TEST_MODE" == preflight_fail && "$2" == *3100 ]] && exit 1
  [[ "$TEST_MODE" == live_fail && "$2" == *3000 && "$3" == "$NEW_ID" ]] && exit 1
  [[ "$TEST_MODE" == rollback_fail && "$2" == *3000 ]] && exit 1
  exit 0
fi
exit 99
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sudo'), '#!/usr/bin/env bash\necho "restart $*" >> "$COMMAND_LOG"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), '#!/usr/bin/env bash\nprintf 200\n', { mode: 0o755 });
  const archive = path.join(root, 'incoming', newId + '.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', source, '.']);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const log = path.join(temp, 'commands.log');
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, REAL_NODE: process.execPath,
    PROKACHKA_DEPLOY_CONFIG: configFile, TEST_MODE: mode, COMMAND_LOG: log, NEW_ID: newId };
  let result;
  try {
    result = { ...(await run('bash', [path.resolve(__dirname, '../scripts/deploy-production.sh'), newId,
      options.badChecksum ? '0'.repeat(64) : digest], { env, timeout: 15000 })), code: 0 };
  } catch (error) { result = error; }
  return { result, previous, current: fs.existsSync(path.join(root, 'current')) ? fs.readlinkSync(path.join(root, 'current')) : null,
    commands: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}

const linuxOnly = { skip: process.platform !== 'linux' };
test('successful deploy activates the exact tested release and restarts once', linuxOnly, async (t) => {
  const state = await scenario(t, 'success');
  assert.equal(state.result.code, 0, state.result.stderr);
  assert.ok(state.current.endsWith(newId));
  assert.equal(state.commands.match(/^restart /gm).length, 1);
});
test('failed candidate leaves the running release and service untouched', linuxOnly, async (t) => {
  const state = await scenario(t, 'preflight_fail');
  assert.notEqual(state.result.code, 0);
  assert.equal(state.current, state.previous);
  assert.doesNotMatch(state.commands, /restart/);
});
test('checksum mismatch never starts or activates the artifact', linuxOnly, async (t) => {
  const state = await scenario(t, 'success', { badChecksum: true });
  assert.notEqual(state.result.code, 0);
  assert.equal(state.current, state.previous);
  assert.equal(state.commands, '');
});
test('post-switch failure restores and verifies the previous ready build', linuxOnly, async (t) => {
  const state = await scenario(t, 'live_fail');
  assert.notEqual(state.result.code, 0);
  assert.equal(state.current, state.previous);
  assert.equal(state.commands.match(/^restart /gm).length, 2);
  assert.match(state.result.stderr, /Previous version restored and checked/);
});
test('rollback failure stays a failed deployment and is explicitly reported', linuxOnly, async (t) => {
  const state = await scenario(t, 'rollback_fail');
  assert.notEqual(state.result.code, 0);
  assert.match(state.result.stderr, /ROLLBACK FAILED/);
  assert.doesNotMatch(state.result.stderr, /Previous version restored and checked/);
});
test('first-deploy failure restores legacy launcher mode', linuxOnly, async (t) => {
  const state = await scenario(t, 'live_fail', { legacy: true });
  assert.notEqual(state.result.code, 0);
  assert.equal(state.current, null);
  assert.match(state.result.stderr, /Previous version restored and checked/);
});
