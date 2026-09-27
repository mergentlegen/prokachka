const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const load = require('./helpers/load-ts.cjs');
const dbKey = '@/backend/infrastructure/supabase/admin-client';
const currentKey = '@/backend/http/current-user';
const authKey = '@/backend/services/auth.service';
const envKey = '@/backend/config/env';
const uuid = '11111111-1111-4111-8111-111111111111';

async function withEnv(values, run) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.entries(values).forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  try { return await run(); } finally {
    Object.entries(saved).forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  }
}

test('password policy is shared, permits no-special-character passwords and preserves legacy login', () => {
  const { validateNewPassword, validateExistingPassword } = load('shared/domain/password-policy.ts');
  const { validateRegistration } = load('backend/services/auth.service.ts', { [dbKey]: { getSupabaseAdmin: () => null } });
  for (const value of ['Abcdefg1', 'ПароЛь12', 'A' + '1'.repeat(1023)]) {
    assert.equal(validateNewPassword(value), null);
    assert.equal(validateRegistration('Anna', 'Member', 'a@example.com', value), null);
  }
  for (const value of [null, 12345678, '', 'Abcdef1', 'abcdefg1', 'ABCDEFGH', 'АБВГДЕЁЖ', 'A1' + 'x'.repeat(1023)]) {
    assert.ok(validateNewPassword(value));
    assert.ok(validateRegistration('Anna', 'Member', 'a@example.com', value));
  }
  assert.equal(validateExistingPassword('123456'), null);
});

test('session parser rejects malformed signatures, payload types, expiry and tampering without throwing', async () => {
  await withEnv({ NODE_ENV: 'production', AUTH_SECRET: 'fixture-session-secret-with-at-least-32-characters' }, async () => {
    const auth = load('backend/services/auth.service.ts', { [envKey]: { serverEnv: {} }, [dbKey]: { getSupabaseAdmin: () => null } });
    const user = { id: uuid, name: 'Member', role: 'member', sessionVersion: 2 };
    const valid = auth.createSession(user);
    assert.equal(auth.readSession(valid).id, uuid);
    const sign = value => {
      const body = Buffer.from(JSON.stringify(value)).toString('base64url');
      return body + '.' + createHmac('sha256', process.env.AUTH_SECRET).update(body).digest('base64url');
    };
    for (const token of [undefined, '', 'x.' + 'ё'.repeat(43), valid + '.extra', valid + 'x', 'x'.repeat(9000),
      sign(null), sign([]), sign({ ...user, exp: 1 }), sign({ ...user, exp: '999999999999999' }),
      sign({ ...user, role: 'root', exp: Date.now() + 10000 }), sign({ ...user, name: null, exp: Date.now() + 10000 })]) {
      assert.equal(auth.readSession(token), null);
    }
    const [body, signature] = valid.split('.');
    assert.equal(auth.readSession(body.slice(0, -1) + (body.endsWith('a') ? 'b' : 'a') + '.' + signature), null);
  });
});

test('rotating system credentials invalidates existing CEO cookies', async () => {
  await withEnv({ AUTH_SECRET: 'system-credential-test-at-least-32-characters' }, async () => {
    const serverEnv = { ceoLogin: 'ceo@example.com', ceoPassword: 'First-secret1' };
    const auth = load('backend/services/auth.service.ts', { [envKey]: { serverEnv }, [dbKey]: { getSupabaseAdmin: () => null } });
    const token = auth.createSession({ id: 'ceo', name: 'CEO', role: 'ceo' });
    assert.equal(auth.readSession(token).role, 'ceo');
    serverEnv.ceoPassword = 'Second-secret2'; assert.equal(auth.readSession(token), null);
    const fresh = auth.createSession({ id: 'ceo', name: 'CEO', role: 'ceo' });
    assert.ok(auth.readSession(fresh));
    serverEnv.ceoLogin = ''; assert.equal(auth.readSession(fresh), null);
  });
});

test('production refuses development headers and demo accounts when the database is absent', async () => {
  await withEnv({ NODE_ENV: 'production', AUTH_DEV_MODE: 'true', AUTH_SECRET: 'production-fixture-at-least-32-characters' }, async () => {
    assert.equal(load('backend/config/env.ts').serverEnv.authDevMode, false);
    assert.equal(load('backend/http/security.ts').isProductionConfigSafe(), false);
    const auth = load('backend/services/auth.service.ts', { [envKey]: { serverEnv: {} }, [dbKey]: { getSupabaseAdmin: () => null } });
    assert.equal((await auth.authenticateAccount('a@example.com', 'Password1')).status, 503);
    assert.equal((await auth.registerAccount('Anna', 'Member', 'a@example.com', 'Password1')).status, 503);
    assert.equal(auth.getSessionToken(new Request('http://localhost', { headers: { authorization: 'Bearer forged', 'x-incruises-dev-session': 'forged' } })), undefined);
  });
});

test('administrative writes revalidate revoked or demoted users instead of trusting cookie roles', async () => {
  await withEnv({ NODE_ENV: 'production' }, async () => {
    const { hasRole } = load('backend/http/auth-guard.ts');
    for (const current of [null, { id: uuid, name: 'Former CEO', role: 'member', sessionVersion: 0 }, { id: uuid, name: 'CEO', role: 'ceo', sessionVersion: 1 }]) {
      const overrides = {
        '@/backend/http/auth-guard': { hasRole, getRequestUser: () => ({ id: uuid, name: 'Stale CEO', role: 'ceo', sessionVersion: 0 }) },
        [authKey]: { findAccountById: async () => current },
        '@/backend/services/users.service': {}, '@/backend/services/teams.service': {},
      };
      const teams = load('backend/controllers/teams.controller.ts', overrides);
      const users = load('backend/controllers/users.controller.ts', overrides);
      for (const action of [teams.createTeamController, teams.updateTeamController, teams.deleteTeamController, teams.permanentlyDeleteTeamController,
        users.upsertUser, users.updateUserAccessController, users.deleteUserController]) {
        const response = await action(new Request('https://prokachka.kz/api/teams', { method: 'POST', body: '{}' }), uuid);
        assert.ok([401, 403].includes(response.status));
      }
    }
  });
});

test('JSON limits count actual bytes, reject malformed objects, and terminate stalled streams', async () => {
  const { readLimitedJson, readLimitedBytes, setRequestBodyLimit } = load('backend/http/request-body.ts');
  for (const contentLength of [undefined, '1']) {
    const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(500) }), headers: contentLength ? { 'content-length': contentLength } : {} });
    setRequestBodyLimit(req, 128);
    await assert.rejects(() => readLimitedJson(req), error => error.status === 413);
  }
  for (const body of ['null', '[]', '123', '"hello"', '{']) {
    await assert.rejects(() => readLimitedJson(new Request('http://localhost', { method: 'POST', body })), error => error.status === 400);
  }
  assert.deepEqual(await readLimitedJson(new Request('http://localhost', { method: 'POST', body: '{"name":"Anna"}' })), { name: 'Anna' });
  let cancelled = false;
  const slow = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(() => readLimitedBytes(new Request('http://localhost', { method: 'POST', body: slow, duplex: 'half' }), 100, 10), error => error.status === 408);
  assert.equal(cancelled, true);
});

test('multipart limits reject oversized bodies without Content-Length and preserve valid forms', async () => {
  const { readLimitedFormData } = load('backend/http/form-data.ts');
  const form = new FormData(); form.set('file', new Blob(['%PDF-' + 'x'.repeat(512)], { type: 'application/pdf' }), 'test.pdf');
  await assert.rejects(() => readLimitedFormData(new Request('http://localhost', { method: 'POST', body: form }), 128), error => error.status === 413);
  const result = await readLimitedFormData(new Request('http://localhost', { method: 'POST', body: form }), 4096);
  assert.equal(result.get('file').name, 'test.pdf');
});

test('production CSRF authority comes from configured origin, never forged Host or forwarded headers', async () => {
  await withEnv({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://prokachka.kz' }, async () => {
    const { enforceRequestSecurity } = load('backend/http/security.ts');
    const req = (origin, url = 'https://prokachka.kz/api/tasks') => new Request(url, { method: 'POST', headers: origin ? { origin, host: 'evil.example', 'x-forwarded-host': 'evil.example' } : {} });
    assert.equal(enforceRequestSecurity(req('https://evil.example', 'https://evil.example/api/tasks'), 'csrf').status, 403);
    assert.equal(enforceRequestSecurity(req(undefined), 'csrf').status, 403);
    assert.equal(enforceRequestSecurity(req('https://prokachka.kz'), 'csrf'), null);
    assert.equal(enforceRequestSecurity(req('https://www.prokachka.kz'), 'csrf'), null);
  });
});

test('rate-limiter saturation cannot evict active counters and forwarded first-hop spoofing does not reset them', () => {
  const { enforceRateLimit, enforceRequestSecurity } = load('backend/http/security.ts');
  for (let i = 0; i < 10000; i++) assert.equal(enforceRateLimit('key-' + i, 1, 60000), null);
  assert.equal(enforceRateLimit('new-key', 1, 60000).status, 429);
  assert.equal(enforceRateLimit('key-0', 1, 60000).status, 429);
  assert.equal(enforceRateLimit('key-1', 1, 60000).headers.get('cache-control'), 'no-store');
  const isolated = load('backend/http/security.ts');
  for (let i = 0; i < 3; i++) {
    const req = new Request('http://localhost', { headers: { 'x-forwarded-for': `192.0.2.${i + 1}, 198.51.100.1` } });
    assert.equal(isolated.enforceRequestSecurity(req, 'spoof', { max: 2 })?.status, i === 2 ? 429 : undefined);
  }
  assert.equal(typeof enforceRequestSecurity, 'function');
});

test('durable login guard hashes identities, bounds retry metadata and fails closed on missing migration', async () => {
  for (const result of [{ data: { allowed: true } }, { data: { allowed: false, retryAfter: 5000 } }, { error: { message: 'private database details' } }, { data: {} }]) {
    const calls = [];
    const { checkLoginAttempt } = load('backend/services/login-security.service.ts', { [dbKey]: { getSupabaseAdmin: () => ({ async rpc(name, args) { calls.push([name, args]); return result; } }) } });
    const response = await checkLoginAttempt(' MEMBER@example.com ');
    assert.equal(calls[0][0], 'app_login_attempt_limit');
    assert.match(calls[0][1].p_email_hash, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(calls).includes('example.com'));
    if (result.data?.allowed) assert.equal(response, null);
    else if (result.data?.allowed === false) { assert.equal(response.status, 429); assert.equal(response.retryAfter, 900); }
    else { assert.equal(response.status, 503); assert.ok(!response.error.includes('private')); }
  }
});

test('login endpoint stops before password verification when durable limit rejects the request', async () => {
  const { login } = load('backend/controllers/auth.controller.ts', {
    '@/backend/http/security': { isProductionConfigSafe: () => true, enforceRateLimit: () => null },
    '@/backend/services/login-security.service': { checkLoginAttempt: async () => ({ error: 'Limited', status: 429, retryAfter: 900 }) },
    [authKey]: { validateLoginCredentials: () => null, authenticateAccount: () => assert.fail('rate-limited password was checked') },
  });
  const response = await login(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ email: 'member@example.com', password: 'Password1' }) }));
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '900');
});

test('live connections have per-account and total budgets; double cleanup cannot release another slot', () => {
  const { acquireLiveConnection: acquire } = load('backend/http/connection-limit.ts');
  const release = Array.from({ length: 5 }, () => acquire('member'));
  assert.ok(release.every(Boolean)); assert.equal(acquire('member'), null);
  release[0](); release[0]();
  const extra = acquire('member'); assert.ok(extra); assert.equal(acquire('member'), null);
  release.slice(1).forEach(fn => fn()); extra();
  const all = Array.from({ length: 2000 }, (_, i) => acquire('user-' + i));
  assert.ok(all.every(Boolean)); assert.equal(acquire('one-more'), null);
  all.forEach(fn => fn()); assert.ok(acquire('released'));
});

test('SSE rejects the sixth connection and releases the slot when a stream is cancelled', async () => {
  const route = load('app/api/events/route.ts', {
    [currentKey]: { getCurrentUser: async () => ({ id: uuid, role: 'member' }) },
    [authKey]: { getSessionToken: () => 'token', readSession: () => ({ id: uuid }) },
    '@/backend/services/live-events.service': { liveEvents: { subscribe: () => () => {} } },
  });
  const responses = [];
  try {
    for (let i = 0; i < 5; i++) responses.push(await route.GET(new Request('http://localhost/api/events')));
    assert.equal((await route.GET(new Request('http://localhost/api/events'))).status, 429);
    await responses[0].body.cancel();
    responses.push(await route.GET(new Request('http://localhost/api/events')));
    assert.equal(responses.at(-1).status, 200);
  } finally { await Promise.all(responses.map(response => response.body.cancel())); }
});

test('PDF responses remain authorized, uncached and sandboxed; ordinary members cannot submit multipart files', async () => {
  const controller = load('backend/controllers/task-attachments.controller.ts', {
    [currentKey]: { getCurrentUser: async () => ({ id: uuid, role: 'member' }) },
    '@/backend/services/task-attachments.service': { getTaskAttachment: async () => ({ data: {
      file: new Blob(['%PDF-test']), attachment: { fileName: 'test.pdf', sizeBytes: 9 },
    } }) },
  });
  const response = await controller.readTaskAttachment(new Request('http://localhost/api/file'), uuid, uuid);
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await controller.createTaskAttachment(new Request('http://localhost', { method: 'POST', body: 'unparsed' }), uuid)).status, 403);
});
