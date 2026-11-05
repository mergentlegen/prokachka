const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');

// Inputs from the 2026-11-04 security test: each used to reach Postgres and come back as a 500.

const jsonRequest = (body) => new Request('http://localhost/api/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

test('text the database cannot store is refused before it gets there', async () => {
  const { readLimitedJson, BROKEN_TEXT_MESSAGE } = load('backend/http/request-body.ts');
  for (const body of ['{"title":"a\\u0000b"}', '{"a\\u0000":"x"}', '{"title":"\\ud83d"}', '{"title":"\\ude80 end"}', '{"list":[{"deep":["ok","\\u0000"]}]}']) {
    await assert.rejects(readLimitedJson(jsonRequest(body)), (error) => error.status === 400 && error.message === BROKEN_TEXT_MESSAGE, body);
  }
  assert.deepEqual(await readLimitedJson(jsonRequest({ title: 'Круиз 🚀\nвторая строка', points: 5 })), { title: 'Круиз 🚀\nвторая строка', points: 5 });
});

test('multipart text fields are checked the same way', async () => {
  const { readLimitedFormData } = load('backend/http/form-data.ts');
  const formRequest = (value) => { const form = new FormData(); form.set('title', value); return new Request('http://localhost/api/x', { method: 'PATCH', body: form }); };
  await assert.rejects(readLimitedFormData(formRequest('a\u0000b'), 4096), (error) => error.status === 400);
  assert.equal((await readLimitedFormData(formRequest('Анна 🚀'), 4096)).get('title'), 'Анна 🚀');
});

test('a value of the wrong kind or size is the sender’s mistake, other database errors stay server errors', async () => {
  const { databaseFailure, failure } = load('backend/http/api-response.ts');
  const logged = [], original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const bad = databaseFailure({ code: '22P02', message: 'invalid input syntax for type uuid' }, 'Не удалось создать задание.');
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).message, /Проверьте введённые данные/);
    assert.equal(logged.length, 0, 'a refused input is not a server fault');
    assert.equal(databaseFailure({ code: '23505' }, 'Не удалось создать задание.').status, 500);
    assert.equal(databaseFailure(new Error('fetch failed'), 'Не удалось создать задание.').status, 500);
    assert.equal(failure('Некорректные данные.', 400).status, 400);
    assert.equal(logged.length, 2);
    assert.deepEqual(logged[0][1], { status: 500, message: 'Не удалось создать задание.' });
  } finally { console.error = original; }
});

test('a failed database call is logged with its reason but without the sent value', async () => {
  const { timedFetch } = load('backend/infrastructure/supabase/timed-fetch.ts');
  const logged = [], original = { fetch: global.fetch, warn: console.warn };
  console.warn = (...args) => logged.push(args);
  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });
  try {
    global.fetch = reply(400, { code: '22P02', message: 'invalid input syntax for type uuid: "anna@mail.kz"', details: 'Key (email)=(anna@mail.kz)' });
    await timedFetch()('https://x.supabase.co/rest/v1/tasks?email=eq.anna%40mail.kz', { method: 'POST' });
    global.fetch = reply(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
    await timedFetch()('https://x.supabase.co/rest/v1/users');
    global.fetch = reply(401, { message: 'Invalid login credentials' });
    await timedFetch()('https://x.supabase.co/auth/v1/token');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(logged.length, 1, 'no-rows answers and auth replies are ordinary');
    assert.equal(logged[0][0], 'Supabase request failed');
    assert.deepEqual(logged[0][1], { step: 'rest tasks', method: 'POST', status: 400, code: '22P02', reason: 'invalid input syntax for type uuid: "…"' });
    assert.doesNotMatch(JSON.stringify(logged), /anna/);

    global.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); };
    await assert.rejects(timedFetch()('https://x.supabase.co/rest/v1/rpc/app_ranking', { method: 'POST' }), /fetch failed/);
    assert.deepEqual(logged[1][1], { step: 'rpc app_ranking', method: 'POST', error: 'TypeError', cause: 'ECONNRESET' });
  } finally { global.fetch = original.fetch; console.warn = original.warn; }
});

test('task fields stored as integers or ids are checked before the database', async () => {
  const inputs = [];
  const controller = load('backend/controllers/tasks.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'mentor', role: 'admin', teamId: 'a98a099e-8d8c-4cfb-882b-dcc6b56f845f' }) },
    '@/backend/services/tasks.service': {
      insertTask: async (input) => { inputs.push(input); return { data: { id: 'task' } }; },
      patchTask: async (_id, input) => { inputs.push(input); return { data: { id: 'task' } }; },
    },
  });
  const create = (extra) => controller.createTask(jsonRequest({ title: 'Задание', description: 'Описание задания', ...extra }));
  for (const extra of [{ position: 'abc' }, { position: 1.5 }, { position: 0 }, { deadlineHours: 9999 }, { deadlineHours: '72' }, { programId: 'not-an-id' }]) {
    assert.equal((await create(extra)).status, 400, JSON.stringify(extra));
  }
  assert.equal((await create({ position: 2, deadlineHours: 72 })).status, 201);
  const update = (body) => controller.updateTask(new Request('http://localhost/api/tasks/x', { method: 'PATCH', body: JSON.stringify(body) }), 'b0f0f49f-d768-4198-ab7c-9ee7a73cfae5');
  assert.equal((await update({ deadlineHours: -1 })).status, 400);
  assert.equal((await update({ deadlineHours: 48 })).status, 200);
  assert.equal(inputs.length, 2);
});

test('profile version must be the saved timestamp, not anything Date.parse accepts', async () => {
  const ownId = '11111111-1111-4111-8111-111111111111';
  const saved = [];
  const controller = load('backend/controllers/profile.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: ownId, role: 'member', teamId: 'team' }) },
    '@/backend/http/security': { isUuid: (value) => value === ownId, enforceRateLimit: () => null },
    '@/backend/config/env': { serverEnv: { authDevMode: false } },
    '@/backend/services/auth.service': { findAccountById: async () => ({ id: ownId, role: 'member' }), createSession: () => 'session' },
    '@/backend/services/profile.service': { normalizeAvatar: () => assert.fail('no photo'), saveOwnProfile: async (...args) => { saved.push(args); return { data: true }; } },
  });
  const request = (expectedVersion) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ firstName: 'Anna', lastName: 'Member', avatarAction: 'keep', expectedVersion })) form.set(key, value);
    return new Request('http://localhost/api/profile', { method: 'PATCH', body: form });
  };
  for (const odd of ['1', '0', 'Monday 5', '12/31/1999']) assert.equal((await controller.updateOwnProfile(request(odd))).status, 409, odd);
  assert.equal(saved.length, 0);
  for (const real of ['2026-11-04T08:10:09.123456+00:00', '2026-09-26T10:00:00.000Z']) assert.equal((await controller.updateOwnProfile(request(real))).status, 200, real);
});

test('a second pending join request gets a clear answer instead of a server error', async () => {
  const query = (result) => { const q = new Proxy({}, { get: (_t, key) => key === 'then' ? (resolve) => resolve(result) : () => q }); return q; };
  const replies = { users: { data: { team_id: null }, error: null }, teams: { data: { id: 'team' }, error: null }, team_join_requests: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "team_join_requests_one_pending_idx"' } } };
  const { createJoinRequest } = load('backend/services/team-requests.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ from: (table) => query(replies[table]) }) },
  });
  assert.deepEqual(await createJoinRequest('user', 'team'), { validationError: 'Заявка уже отправлена. Дождись ответа наставника.' });
});
