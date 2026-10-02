const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

const { supabaseStep, timedFetch } = loadTs('backend/infrastructure/supabase/timed-fetch.ts');

test('slow-request log names only the step, never emails, ids or file names', () => {
  assert.equal(supabaseStep('https://x.supabase.co/rest/v1/users?select=id&email=eq.anna%40mail.kz'), 'rest users');
  assert.equal(supabaseStep('https://x.supabase.co/rest/v1/rpc/app_ranking'), 'rpc app_ranking');
  assert.equal(supabaseStep('https://x.supabase.co/auth/v1/signup'), 'auth signup');
  assert.equal(supabaseStep('https://x.supabase.co/storage/v1/object/sign/avatars/user-1/photo.jpg'), 'storage object sign avatars');
  assert.equal(supabaseStep('https://x.supabase.co/storage/v1/object/announcements/team/secret.png'), 'storage object announcements');
});

test('only requests slower than the threshold are logged', async () => {
  const logged = [], original = { fetch: global.fetch, warn: console.warn, now: performance.now };
  let clock = 0;
  global.fetch = async () => ({ status: 200 });
  console.warn = (...args) => logged.push(args);
  performance.now = () => clock;
  try {
    const run = timedFetch();
    clock = 0; const fast = run('https://x.supabase.co/rest/v1/tasks'); clock = 120; await fast;
    assert.equal(logged.length, 0);
    const slow = run('https://x.supabase.co/auth/v1/signup', { method: 'POST' }); clock = 2120; await slow;
    assert.deepEqual(logged[0][1], { step: 'auth signup', method: 'POST', status: 200, ms: 2000 });
  } finally { global.fetch = original.fetch; console.warn = original.warn; performance.now = original.now; }
});
