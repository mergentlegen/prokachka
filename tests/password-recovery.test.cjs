const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const dbKey = '@/backend/infrastructure/supabase/admin-client';
const clientKey = '@/backend/infrastructure/supabase/auth-client';
const serviceKey = '@/backend/services/password-recovery.service';
const email = 'person@example.com';
const identity = { id: 'auth-id', email, email_confirmed_at: '2026-01-01' };
const providerSession = { access_token: 'private-access-token', refresh_token: 'private-refresh-token' };
const previousSecret = process.env.AUTH_SECRET;
test.before(() => { process.env.AUTH_SECRET = 'recovery-fixture-secret-at-least-32-characters'; });
test.after(() => { if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret; });

function service({ account = { id: 'app-id', role: 'member', auth_user_id: 'auth-id' }, denied = false, otpError, otpUser = identity, claimStatus = 'ok', updateError, restoreUser = identity, finishError } = {}) {
  const calls = [];
  let mod;
  const admin = {
    from() {
      const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return { data: account }; } };
      return query;
    },
    auth: { admin: { async generateLink(value) { calls.push(['prepare', value]); return { data: { user: identity } }; } } },
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'app_password_recovery_limit') return { data: { allowed: !denied, retryAfter: 360 } };
      if (name === 'app_claim_password_recovery') return { data: { status: claimStatus, authUserId: identity.id, encryptedSession: mod.sealRecoverySession(providerSession) } };
      if (name === 'app_finish_password_recovery') return { error: finishError };
      return {};
    },
  };
  const client = { auth: {
    async resetPasswordForEmail(value) { calls.push(['send', value]); return {}; },
    async verifyOtp(value) { calls.push(['otp', value]); return otpError ? { error: otpError } : { data: { user: otpUser, session: providerSession } }; },
    async setSession(value) { calls.push(['restore', value]); return { data: { user: restoreUser } }; },
    async updateUser(value) { calls.push(['password', value]); return { error: updateError }; },
    async signOut(value) { calls.push(['signout', value]); return {}; },
  } };
  mod = load('backend/services/password-recovery.service.ts', { [dbKey]: { getSupabaseAdmin: () => admin }, [clientKey]: { getSupabaseAuthClient: () => client } });
  return { ...mod, calls };
}

test('unknown address returns the same response without creating an Auth account or sending a message', async () => {
  const known = service(), unknown = service({ account: null });
  assert.deepEqual(await unknown.requestPasswordRecovery(email), await known.requestPasswordRecovery(email));
  assert.ok(!unknown.calls.some(([name]) => ['prepare', 'send'].includes(name)));
  assert.ok(!known.calls.some(([name]) => name === 'prepare'));
});
test('legacy recovery prepares an identity but never attaches the profile before email proof', async () => {
  const api = service({ account: { id: 'legacy-id', role: 'admin', auth_user_id: null } });
  await api.requestPasswordRecovery(email);
  assert.deepEqual(api.calls.slice(1), [['prepare', { type: 'magiclink', email }], ['send', email]]);
  assert.ok(!api.calls.some(([name]) => name === 'app_issue_password_recovery' || name === 'password'));
});
test('persistent rate limiting rejects send/verify before contacting Auth and stores only address hashes', async () => {
  const api = service({ denied: true });
  assert.equal((await api.requestPasswordRecovery(email)).status, 429);
  assert.equal((await api.verifyPasswordRecovery(email, '012345')).status, 429);
  assert.ok(api.calls.every(([name, args]) => name === 'app_password_recovery_limit' && /^[a-f0-9]{64}$/.test(args.p_email_hash) && !JSON.stringify(args).includes(email)));
});
test('wrong codes, different email or provider ID cannot issue recovery grants', async () => {
  for (const options of [{ otpError: { code: 'otp_expired', status: 403 } }, { otpUser: { ...identity, email: 'other@example.com' } }, { otpUser: { ...identity, id: 'other-id' } }, { otpUser: { ...identity, email_confirmed_at: null } }]) {
    const api = service(options);
    assert.equal((await api.verifyPasswordRecovery(email, '123456')).status, 400);
    assert.ok(!api.calls.some(([name]) => name === 'app_issue_password_recovery'));
  }
});
test('verified recovery uses purpose recovery, an opaque grant, encrypted provider tokens and trusted profile ID', async () => {
  const api = service(); const result = await api.verifyPasswordRecovery(email, '012345');
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(api.calls[1], ['otp', { email, token: '012345', type: 'recovery' }]);
  const saved = api.calls[2][1];
  assert.equal(saved.p_account_id, 'app-id'); assert.equal(saved.p_auth_user_id, 'auth-id');
  assert.ok(!JSON.stringify(saved).includes(result.token)); assert.ok(!JSON.stringify(saved).includes(providerSession.access_token));
  assert.deepEqual(api.openRecoverySession(saved.p_encrypted_session), providerSession);
});
test('encrypted grants reject ciphertext modification and changes to the Auth secret', () => {
  const api = service(); const encrypted = api.sealRecoverySession(providerSession);
  const bytes = Buffer.from(encrypted, 'base64url'); bytes[30] ^= 1;
  assert.throws(() => api.openRecoverySession(bytes.toString('base64url')));
  const saved = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'different-fixture-secret-with-32-characters';
  try { assert.throws(() => api.openRecoverySession(encrypted)); } finally { process.env.AUTH_SECRET = saved; }
});
test('expired, busy or mismatched grants never update passwords', async () => {
  for (const options of [{ claimStatus: 'invalid' }, { claimStatus: 'busy' }, { restoreUser: { ...identity, id: 'attacker-id' } }]) {
    const api = service(options); const result = await api.resetRecoveredPassword('opaque-token', 'new-secret');
    assert.ok(result.error); assert.ok(!api.calls.some(([name]) => name === 'password'));
  }
});
test('a password-policy failure releases the lease so a different password can be submitted without another OTP', async () => {
  const api = service({ updateError: { code: 'weak_password' } });
  assert.equal((await api.resetRecoveredPassword('opaque-token', 'too-weak')).status, 400);
  assert.equal(api.calls.at(-1)[0], 'app_release_password_recovery');
  assert.ok(!api.calls.some(([name]) => name === 'app_finish_password_recovery'));
});
test('reset consumes the grant and revokes provider sessions; a completed Auth update can be safely retried', async () => {
  for (const updateError of [undefined, { code: 'same_password' }]) {
    const api = service({ updateError });
    assert.deepEqual(await api.resetRecoveredPassword('opaque-token', 'new-password'), { passwordReset: true });
    assert.equal(api.calls.at(-2)[0], 'app_finish_password_recovery');
    assert.deepEqual(api.calls.at(-1), ['signout', { scope: 'global' }]);
  }
});
test('a DB finalization error keeps the verified grant retryable and does not claim success', async () => {
  const api = service({ finishError: { message: 'private database detail' } });
  const result = await api.resetRecoveredPassword('opaque-token', 'new-password');
  assert.equal(result.status, 503); assert.ok(!JSON.stringify(result).includes('private database detail'));
  assert.equal(api.calls.at(-1)[0], 'app_release_password_recovery');
});
test('controllers accept only a verified HttpOnly grant, never caller IDs, and validate passwords before using it', async () => {
  const calls = [];
  const controller = load('backend/controllers/password-recovery.controller.ts', {
    '@/backend/config/env': { serverEnv: { emailVerificationEnabled: true } },
    '@/backend/http/security': { isProductionConfigSafe: () => true },
    [serviceKey]: {
      verifyPasswordRecovery: async (address, code) => { assert.equal(address, email); assert.equal(code, '012345'); return { token: 'A'.repeat(43), expiresIn: 600 }; },
      resetRecoveredPassword: async (token, password) => { calls.push([token, password]); return { passwordReset: true }; },
    },
  });
  const req = (body, cookie = '') => new Request('http://localhost/api/auth/password/reset', { method: 'POST', headers: { cookie }, body: JSON.stringify(body) });
  const verified = await controller.verifyRecovery(req({ email, code: '012345' }));
  assert.ok(!(await verified.clone().json()).token); assert.match(verified.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const cookie = 'prokachka_password_recovery=' + 'A'.repeat(43);
  assert.equal((await controller.resetPassword(req({ password: 'new-secret', passwordConfirmation: 'new-secret', userId: 'attacker' }))).status, 410);
  assert.equal((await controller.resetPassword(req({ password: 'short', passwordConfirmation: 'short' }, cookie))).status, 400);
  assert.equal((await controller.resetPassword(req({ password: 'new-secret', passwordConfirmation: 'different' }, cookie))).status, 400);
  assert.equal(calls.length, 0);
  const result = await controller.resetPassword(req({ password: 'new-secret', passwordConfirmation: 'new-secret', userId: 'attacker' }, cookie));
  assert.deepEqual(calls, [['A'.repeat(43), 'new-secret']]);
  assert.match(result.headers.get('set-cookie'), /incruises_session=.*Max-Age=0/);
});
test('old signed sessions are rejected after reset, including sessions without a version field', async () => {
  for (const version of [undefined, 0, 1]) {
    const { getCurrentUser } = load('backend/http/current-user.ts', {
      '@/backend/http/auth-guard': { getRequestUser: () => ({ id: 'app-id', sessionVersion: version }) },
      '@/backend/services/auth.service': { findAccountById: async () => ({ id: 'app-id', sessionVersion: 1 }) },
    });
    assert.equal(Boolean(await getCurrentUser(new Request('http://localhost'))), version === 1);
  }
});

test('recovery controllers reject malformed JSON and non-object payloads without using Auth', async () => {
  const controller = load('backend/controllers/password-recovery.controller.ts', {
    '@/backend/config/env': { serverEnv: { emailVerificationEnabled: true } },
    '@/backend/http/security': { isProductionConfigSafe: () => true },
    [serviceKey]: new Proxy({}, { get() { throw new Error('Auth must not be called'); } }),
  });
  for (const body of ['{', 'null', '[]', '"value"']) {
    for (const method of ['requestRecovery', 'verifyRecovery', 'resetPassword']) {
      const request = new Request('http://localhost/api/auth/password/reset', {
        method: 'POST', headers: { cookie: 'prokachka_password_recovery=' + 'A'.repeat(43) }, body,
      });
      assert.equal((await controller[method](request)).status, 400);
    }
  }
});

test('recovery routes enforce request security before invoking controllers', async () => {
  for (const route of ['request', 'verify', 'reset']) {
    let called = false;
    const { POST } = load(`app/api/auth/password/${route}/route.ts`, {
      '@/backend/controllers/password-recovery.controller': {
        requestRecovery: () => { called = true; }, verifyRecovery: () => { called = true; }, resetPassword: () => { called = true; },
      },
      '@/backend/http/security': { enforceRequestSecurity: () => new Response('blocked', { status: 403 }) },
    });
    assert.equal((await POST(new Request('http://localhost', { method: 'POST' }))).status, 403);
    assert.equal(called, false);
  }
});
test('restored browser navigation excludes credentials, codes and tokens and rejects expired state', () => {
  const { restorePasswordRecovery } = load('frontend/features/auth/PasswordRecovery.tsx', { 'next/image': () => null });
  const state = { step: 'password', email, resendAt: 0, expiresAt: Date.now() + 600000 };
  assert.deepEqual(restorePasswordRecovery(JSON.stringify({ ...state, code: '012345', password: 'secret', token: 'private' })), state);
  assert.equal(restorePasswordRecovery(JSON.stringify({ ...state, expiresAt: 1 })), null);
});
