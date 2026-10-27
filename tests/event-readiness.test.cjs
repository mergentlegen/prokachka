const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const limit = (file, bucket) => {
  const match = read(file).match(new RegExp(`"${bucket}", \\{ max: (\\d+), windowMs: ([^,]+),`));
  assert.ok(match, `${bucket} limit in ${file}`);
  return { max: Number(match[1]), window: match[2].trim() };
};

test('sign-in pages let a whole event on one Wi-Fi in, per IP', () => {
  // Many participants behind one public IP (event Wi-Fi, mobile operator NAT) must not lock each other out.
  assert.deepEqual(limit('app/api/auth/login/route.ts', 'auth-login'), { max: 60, window: '60_000' });
  assert.deepEqual(limit('app/api/auth/register/route.ts', 'auth-register'), { max: 60, window: '10 * 60_000' });
  assert.deepEqual(limit('app/api/auth/verify-email/route.ts', 'auth-verify-email'), { max: 120, window: '10 * 60_000' });
  assert.deepEqual(limit('app/api/auth/resend-email/route.ts', 'auth-resend-email'), { max: 60, window: '60 * 60_000' });
  assert.deepEqual(limit('app/api/auth/password/request/route.ts', 'password-recovery-send'), { max: 40, window: '60 * 60_000' });
  assert.deepEqual(limit('app/api/auth/password/verify/route.ts', 'password-recovery-verify'), { max: 60, window: '10 * 60_000' });
  assert.deepEqual(limit('app/api/auth/password/reset/route.ts', 'password-recovery-reset'), { max: 40, window: '10 * 60_000' });
});

test('guessing a password is still stopped per account, whatever the IP', () => {
  const security = read('backend/services/login-security.service.ts');
  assert.match(security, /app_login_attempt_limit/);
  assert.match(security, /Подождите 15 минут/);
  assert.match(read('backend/services/auth.service.ts') + read('backend/controllers/auth.controller.ts'), /checkLoginAttempt\(/, 'the login flow asks the per-account counter');
});
