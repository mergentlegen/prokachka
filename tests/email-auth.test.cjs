const test = require('node:test');
const assert = require('node:assert/strict');
const { scryptSync } = require('node:crypto');
const load = require('./helpers/load-ts.cjs');
const dbKey = '@/backend/infrastructure/supabase/admin-client';
const clientKey = '@/backend/infrastructure/supabase/auth-client';
const emailKey = '@/backend/services/email-auth.service';
const envKey = '@/backend/config/env';
const verified = { id: 'auth-id', email: 'person@example.com', email_confirmed_at: '2026-01-01' };
const input = { firstName: ' Anna ', lastName: ' Member ', email: ' PERSON@example.com ', password: 'secret-password' };

function service({ existing = null, draft = null, signup, otp, login, gate, provision, saveError, invitation } = {}) {
  const calls = [];
  const admin = {
    from(table) {
      const query = {
        select() { return query; }, eq() { return query; },
        async maybeSingle() { return { data: table === 'users' ? existing : draft }; },
        async upsert(data) { calls.push(['draft', data]); return { error: saveError }; },
      };
      return query;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      return name === 'app_email_auth_limit' ? (gate || { data: { allowed: true } }) : (provision || { data: 'app-id' });
    },
  };
  const client = { auth: {
    async signUp(value) { calls.push(['signup', value]); return signup || { data: { session: null, user: { ...verified, email_confirmed_at: null, identities: [{}] } } }; },
    async verifyOtp(value) { calls.push(['otp', value]); return otp || { data: { user: verified } }; },
    async resend(value) { calls.push(['resend', value]); return {}; },
    async signInWithPassword(value) { calls.push(['login', value]); return login || { data: { user: verified } }; },
  } };
  const mod = load('backend/services/email-auth.service.ts', {
    [dbKey]: { getSupabaseAdmin: () => admin }, [clientKey]: { getSupabaseAuthClient: () => client },
    '@/backend/services/network.service': { findInvitationByToken: async () => invitation || { data: { id: 'invite-id' } } },
  });
  return { ...mod, calls };
}

test('signup stores a names/invitation draft only; no password, OTP, session or app user', async () => {
  const api = service();
  const result = await api.beginEmailRegistration({ ...input, inviteToken: 'invitation-token' });
  assert.deepEqual(result, { verificationRequired: true, email: 'person@example.com', resendAfter: 60 });
  assert.deepEqual(api.calls[0], ['signup', { email: 'person@example.com', password: input.password }]);
  assert.deepEqual(api.calls[1], ['draft', { auth_user_id: 'auth-id', email: 'person@example.com', first_name: 'Anna', last_name: 'Member', invitation_id: 'invite-id' }]);
});

test('signup fails closed when Confirm Email is disabled, email already exists, or invitation is invalid', async () => {
  let api = service({ signup: { data: { session: { access_token: 'must-not-escape' }, user: verified } } });
  assert.equal((await api.beginEmailRegistration(input)).status, 503);
  assert.equal(api.calls.length, 1);
  api = service({ existing: { id: 'legacy-account' } });
  assert.equal((await api.beginEmailRegistration(input)).status, 409);
  assert.equal(api.calls.length, 0);
  api = service({ invitation: { validationError: 'Expired invitation' } });
  assert.equal((await api.beginEmailRegistration({ ...input, inviteToken: 'bad' })).status, 400);
  assert.equal(api.calls.length, 0);
});

test('duplicate provider account and unavailable draft storage never create application sessions', async () => {
  const duplicate = service({ signup: { data: { session: null, user: { ...verified, identities: [] } } } });
  assert.equal((await duplicate.beginEmailRegistration(input)).status, 409);
  const failed = service({ saveError: { code: '42P01' } });
  assert.equal((await failed.beginEmailRegistration(input)).status, 503);
  assert.ok(!failed.calls.some(([name]) => name === 'app_complete_email_registration'));
});

test('persistent signup/resend and verify limits run before contacting Auth', async () => {
  const api = service({ draft: { auth_user_id: 'auth-id' }, gate: { data: { allowed: false, retryAfter: 371 } } });
  for (const run of [() => api.beginEmailRegistration(input), () => api.verifyEmailRegistration(verified.email, '012345'), () => api.resendRegistrationEmail(verified.email)]) {
    assert.deepEqual(await run(), { error: 'Слишком много попыток. Попробуйте чуть позже.', status: 429, retryAfter: 371 });
  }
  assert.ok(api.calls.every(([name]) => name === 'app_email_auth_limit'));
});

test('correct OTP uses verified provider ID and the atomic provisioning RPC', async () => {
  const api = service();
  assert.deepEqual(await api.verifyEmailRegistration(verified.email, '012345'), { accountId: 'app-id' });
  assert.deepEqual(api.calls, [
    ['app_email_auth_limit', { p_email: verified.email, p_action: 'verify' }],
    ['otp', { email: verified.email, token: '012345', type: 'email' }],
    ['app_complete_email_registration', { p_auth_user_id: verified.id }],
  ]);
});

test('wrong/expired codes and wrong provider identity cannot provision any account', async () => {
  for (const otp of [{ error: { status: 403, code: 'otp_expired' } }, { data: { user: { ...verified, email: 'other@example.com' } } }, { data: { user: { ...verified, email_confirmed_at: null } } }]) {
    const api = service({ otp });
    assert.ok((await api.verifyEmailRegistration(verified.email, '123456')).error);
    assert.ok(!api.calls.some(([name]) => name === 'app_complete_email_registration'));
  }
});

test('resend sends signup confirmation, never a passwordless login or a new account', async () => {
  const api = service();
  assert.equal((await api.resendRegistrationEmail(verified.email)).verificationRequired, true);
  assert.deepEqual(api.calls.at(-1), ['resend', { email: verified.email, type: 'signup' }]);
});

test('email-password login recovers interrupted provisioning but refuses mismatched auth IDs', async () => {
  const api = service();
  assert.deepEqual(await api.authenticateEmailAccount(verified.email, 'password', verified.id), { accountId: 'app-id' });
  const wrong = service();
  assert.equal((await wrong.authenticateEmailAccount(verified.email, 'password', 'different-auth-id')).status, 401);
  assert.ok(!wrong.calls.some(([name]) => name === 'app_complete_email_registration'));
  const unconfirmed = service({ login: { error: { code: 'email_not_confirmed' } } });
  assert.deepEqual(await unconfirmed.authenticateEmailAccount(verified.email, 'password'), { verificationRequired: true, email: verified.email, resendAfter: 0 });
});

test('Auth provider errors are sanitized and rate-limit/upstream failures remain distinguishable', async () => {
  const api = service({ otp: { error: { status: 500, message: 'smtp-secret/password' } } });
  const result = await api.verifyEmailRegistration(verified.email, '123456');
  assert.equal(result.status, 503); assert.ok(!JSON.stringify(result).includes('smtp-secret'));
  assert.equal((await service({ login: { error: { status: 429 } } }).authenticateEmailAccount(verified.email, 'password')).status, 429);
});

test('existing users keep their original IDs, roles, team, and password validation', async () => {
  const salt = 'fixed-test-salt'; const password = 'legacy-secret';
  const row = { id: 'legacy-id', email: verified.email, login: verified.email, name: 'Mentor', role: 'admin', team_id: 'team-id',
    password_hash: salt + ':' + scryptSync(password, salt, 64).toString('hex'), auth_user_id: null };
  const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return { data: row }; } };
  const auth = load('backend/services/auth.service.ts', {
    [envKey]: { serverEnv: { emailVerificationEnabled: true } },
    [dbKey]: { getSupabaseAdmin: () => ({ from: () => query }) },
    [emailKey]: { authenticateEmailAccount: () => assert.fail('legacy password must not be sent to another provider') },
    '@/backend/services/avatar-urls.service': { withAvatarUrls: async rows => rows },
  });
  const result = await auth.authenticateAccount(verified.email, password);
  assert.equal(result.user.id, row.id); assert.equal(result.user.role, 'admin'); assert.equal(result.user.teamId, 'team-id');
  assert.ok((await auth.authenticateAccount(verified.email, 'wrong-password')).error);
});

test('linked users cannot fall back to a legacy hash when Supabase rejects the password', async () => {
  const row = { auth_user_id: verified.id, password_hash: 'legacy-would-match' };
  const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return { data: row }; } };
  const auth = load('backend/services/auth.service.ts', {
    [envKey]: { serverEnv: { emailVerificationEnabled: false } }, [dbKey]: { getSupabaseAdmin: () => ({ from: () => query }) },
    [emailKey]: { authenticateEmailAccount: async (_email, _password, id) => { assert.equal(id, verified.id); return { error: 'Rejected', status: 401 }; } },
  });
  assert.deepEqual(await auth.authenticateAccount(verified.email, 'password'), { error: 'Rejected', status: 401 });
});

test('rolling deployment preserves legacy login before migration only when the feature is disabled', async () => {
  const password = 'legacy-password'; const salt = 'rolling-deploy';
  const row = { id: 'legacy-id', role: 'member', password_hash: salt + ':' + scryptSync(password, salt, 64).toString('hex') };
  for (const enabled of [false, true]) {
    let fields = '', reads = 0;
    const query = { select(value) { fields = value; return query; }, eq() { return query; }, async maybeSingle() {
      reads++; return fields.includes('auth_user_id') ? { error: { code: '42703', message: 'column users.auth_user_id does not exist' } } : { data: row };
    } };
    const auth = load('backend/services/auth.service.ts', {
      [envKey]: { serverEnv: { emailVerificationEnabled: enabled } }, [dbKey]: { getSupabaseAdmin: () => ({ from: () => query }) },
      [emailKey]: { authenticateEmailAccount: () => assert.fail('missing schema cannot authenticate with Auth') },
      '@/backend/services/avatar-urls.service': { withAvatarUrls: async rows => rows },
    });
    const result = await auth.authenticateAccount(verified.email, password);
    if (enabled) { assert.equal(result.status, 503); assert.equal(reads, 1); }
    else { assert.equal(result.user.id, row.id); assert.equal(reads, 2); }
  }
});

test('verify controller rejects malformed codes, trusts no caller user ID, and emits a session only after provisioning', async () => {
  let calls = 0;
  const controller = load('backend/controllers/auth.controller.ts', {
    [envKey]: { serverEnv: {} }, '@/backend/http/security': { isProductionConfigSafe: () => true },
    [emailKey]: { verifyEmailRegistration: async (email, code) => { calls++; assert.equal(email, verified.email); assert.equal(code, '012345'); return { accountId: 'trusted-id' }; } },
    '@/backend/services/auth.service': { findAccountById: async id => { assert.equal(id, 'trusted-id'); return { id, role: 'member' }; }, createSession: () => 'signed-session' },
  });
  const request = code => new Request('http://localhost/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ email: 'PERSON@example.com', code, userId: 'attacker', role: 'admin' }) });
  for (const code of ['12345', '1234567', 123456, 'abc123']) assert.equal((await controller.confirmEmail(request(code))).status, 400);
  assert.equal(calls, 0);
  const result = await (await controller.confirmEmail(request('012345'))).json();
  assert.equal(result.user.id, 'trusted-id'); assert.equal(result.session, 'signed-session'); assert.equal(calls, 1);
});

test('auth responses never set cookies for pending/failed requests or expose production tokens', async () => {
  const { withAuthCookie } = load('backend/http/auth-response.ts', { [envKey]: { serverEnv: { authDevMode: false } } });
  const pending = await withAuthCookie(Response.json({ verificationRequired: true }, { status: 202 }));
  assert.equal(pending.headers.get('set-cookie'), null); assert.equal(pending.headers.get('cache-control'), 'no-store');
  const success = await withAuthCookie(Response.json({ user: { id: 'app-id' }, session: 'opaque-signed' }));
  assert.match(success.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal((await success.json()).session, undefined);
});

test('each Auth operation uses a fresh anonymous-key client with persistence and refresh disabled', () => {
  const options = [];
  const { getSupabaseAuthClient } = load('backend/infrastructure/supabase/auth-client.ts', {
    [envKey]: { serverEnv: { supabaseUrl: 'https://project.invalid', supabaseAnonKey: 'public-key', supabaseServiceRoleKey: 'never-use' } },
    '@supabase/supabase-js': { createClient: (url, key, config) => { assert.equal(key, 'public-key'); options.push(config); return {}; } },
  });
  assert.notEqual(getSupabaseAuthClient(), getSupabaseAuthClient());
  assert.deepEqual(options[0].auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
});

test('registration and unconfirmed login return a pending step without minting a session', async () => {
  const controller = load('backend/controllers/auth.controller.ts', {
    [envKey]: { serverEnv: { emailVerificationEnabled: true } },
    '@/backend/http/security': { isProductionConfigSafe: () => true, enforceRateLimit: () => null },
    [emailKey]: { beginEmailRegistration: async value => {
      assert.equal(value.inviteToken, 'abcdefghijklmnopqrst');
      return { verificationRequired: true, email: verified.email, resendAfter: 60 };
    } },
    '@/backend/services/auth.service': {
      validateRegistration: () => null, validateLoginCredentials: () => null,
      registerAccount: () => assert.fail('legacy registration bypass'),
      createSession: () => assert.fail('unconfirmed session'),
      authenticateAccount: async () => ({ verificationRequired: true, email: verified.email, resendAfter: 0 }),
    },
  });
  const request = new Request('http://localhost/api/auth/register', { method: 'POST', body: JSON.stringify({
    ...input, passwordConfirmation: input.password, inviteToken: 'abcdefghijklmnopqrst', role: 'admin', teamId: 'attacker-team',
  }) });
  const registration = await controller.register(request);
  assert.equal(registration.status, 202);
  const body = await registration.json(); assert.equal(body.session, undefined); assert.equal(body.user, undefined);
  const login = await controller.login(new Request('http://localhost/api/auth/login', { method: 'POST', body: JSON.stringify({ email: verified.email, password: 'secret-password' }) }));
  assert.equal(login.status, 202); assert.equal((await login.json()).session, undefined);
});

test('verification endpoints enforce origin and IP security before invoking controllers', async () => {
  for (const [file, handler] of [['verify-email', 'confirmEmail'], ['resend-email', 'resendEmail']]) {
    const route = load(`app/api/auth/${file}/route.ts`, {
      '@/backend/controllers/auth.controller': { [handler]: () => assert.fail('blocked request reached controller') },
      '@/backend/http/security': { enforceRequestSecurity: () => Response.json({ ok: false }, { status: 403 }) },
    });
    assert.equal((await route.POST(new Request(`http://localhost/api/auth/${file}`, { method: 'POST' }))).status, 403);
  }
});

test('confirmation recovery accepts only bounded, unexpired email state and never restores credentials', () => {
  const { restoreEmailConfirmation } = load('frontend/features/auth/EmailConfirmation.tsx', { 'next/image': () => null });
  const saved = { email: verified.email, resendAt: Date.now() + 60000, expiresAt: Date.now() + 3600000, password: 'must-not-restore', code: '123456' };
  assert.deepEqual(restoreEmailConfirmation(JSON.stringify(saved)), { email: verified.email, resendAt: saved.resendAt });
  for (const state of ['garbage', 'null', JSON.stringify({ ...saved, expiresAt: 1 }), JSON.stringify({ ...saved, email: 'invalid' }), JSON.stringify({ ...saved, resendAt: 'bad' })]) {
    assert.equal(restoreEmailConfirmation(state), null);
  }
});
