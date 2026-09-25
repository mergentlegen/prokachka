const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(relative, overrides = {}) {
  const file = path.resolve(__dirname, '..', relative);
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  const original = loaded.require.bind(loaded);
  loaded.require = (name) => name in overrides ? overrides[name] : name.startsWith('@/') ? load(name.slice(2) + '.ts', overrides) : original(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return loaded.exports;
}
const dbKey = '@/backend/infrastructure/supabase/admin-client';
const envKey = '@/backend/config/env';
function database(results = {}) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, ops: [] }; calls.push(call);
    const query = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (resolve, reject) => Promise.resolve(typeof results[table] === 'function' ? results[table](call) : results[table] || { data: [], error: null }).then(resolve, reject);
      return (...args) => { call.ops.push([key, ...args]); return query; };
    } });
    return query;
  } };
}
const dbOverrides = (db) => ({ [dbKey]: { getSupabaseAdmin: () => db } });
const networkKey = '@/backend/services/network.service';
const user = (id, parent = null) => ({ id, parent_user_id: parent, role: 'member', team_id: 'team' });

test('backend descendants support 10,000 levels and cycles cannot reintroduce self', () => {
  const network = load('backend/services/network.service.ts', dbOverrides(null));
  const rows = Array.from({ length: 10000 }, (_, i) => user(String(i), i ? String(i - 1) : null));
  assert.equal(network.descendants(rows, '0', false).size, 9999);
  assert.deepEqual([...network.descendants([user('a', 'b'), user('b', 'a')], 'a', false)], ['b']);
});

test('network reads every page instead of silently stopping at Supabase row limit', async () => {
  const db = database({ users: ({ ops }) => {
    const range = ops.find(([op]) => op === 'range');
    return { data: Array.from({ length: range[1] === 0 ? 500 : 25 }, (_, i) => user(String(range[1] + i))) };
  } });
  const result = await load('backend/services/network.service.ts', dbOverrides(db)).findTeamNetwork('team');
  assert.equal(result.data.length, 525);
  assert.equal(db.calls.length, 2);
});

test('task preparation stores only a hashed, expiring account-bound session, never a placeholder answer', async () => {
  const db = database({ users: { data: { id: 'alice', role: 'member', telegram_id: '111' } } });
  db.rpc = async (name) => { assert.equal(name, 'tg_target_error'); return { data: null }; };
  const service = load('backend/services/telegram-submission.service.ts', { ...dbOverrides(db), [envKey]: { serverEnv: { telegramBotUsername: 'fixture_bot', telegramBotToken: 'fixture' } } });
  const result = await service.prepareTelegramSubmission('alice', 'task');
  const token = new URL(result.url).searchParams.get('start');
  assert.ok(token.length <= 64);
  assert.match(token, /^submit_[A-Za-z0-9_-]{32}$/);
  const insert = db.calls.find((call) => call.table === 'telegram_submission_sessions').ops.find(([op]) => op === 'insert')[1];
  assert.equal(insert.token_hash, service.telegramTokenHash(token.slice(7)));
  assert.equal(insert.user_id, 'alice'); assert.equal(insert.telegram_id, '111'); assert.equal(insert.task_id, 'task');
  assert.ok(Date.parse(insert.expires_at) > Date.now());
  assert.ok(!db.calls.some((call) => call.table === 'submissions'));
});

test('unlinked account and target lookup errors fail closed without writing a session', async () => {
  for (const scenario of ['unlinked', 'lookup-error']) {
    const db = database({ users: { data: { id: 'alice', role: 'member', telegram_id: scenario === 'unlinked' ? null : '111' } } });
    db.rpc = async () => ({ error: { code: 'XX000' } });
    const service = load('backend/services/telegram-submission.service.ts', { ...dbOverrides(db), [envKey]: { serverEnv: { telegramBotUsername: 'fixture_bot', telegramBotToken: 'fixture' } } });
    const result = await service.prepareTelegramSubmission('alice', 'task');
    assert.ok(result.error || result.validationError);
    assert.equal(db.calls.length, 1);
  }
});

test('answer saving uses atomic RPC and cannot accept a client-selected user/task', async () => {
  const db = { rpc: async (name, params) => {
    assert.equal(name, 'tg_submit_answer');
    assert.equal(params.p_telegram_id, '111');
    assert.equal(params.p_update_id, 42);
    assert.ok(!('p_task_id' in params)); assert.ok(!('p_user_id' in params));
    return { data: { data: { id: 'answer' }, duplicate: true } };
  } };
  const service = load('backend/services/telegram-submission.service.ts', { ...dbOverrides(db), [envKey]: { serverEnv: {} } });
  const result = await service.attachTelegramSubmission({ telegramId: '111', chatId: '111', messageId: 12, updateId: 42, mediaType: 'text', answerText: 'Answer' });
  assert.equal(result.duplicate, true);
});

test('reviewer personal history is scoped to self, not the descendant review queue', async () => {
  let options;
  const controller = load('backend/controllers/submissions.controller.ts', {
    '@/backend/http/auth-guard': { getRequestUser: () => ({ id: 'alice', role: 'member', canReview: true, teamId: 'team' }) },
    '@/backend/services/auth.service': { findAccountById: async () => ({ id: 'alice', role: 'member', canReview: true, teamId: 'team' }) },
    '@/backend/http/api-response': { ok: (data) => data, failure: (message, status) => ({ message, status }) },
    '@/backend/http/security': {}, [envKey]: {},
    '@/backend/services/telegram-submission.service': {},
    '@/backend/services/submissions.service': { findSubmissions: async (value) => { options = value; return { data: [] }; } },
  });
  await controller.listSubmissions(new Request('https://fixture.test/api/submissions?userId=alice'));
  assert.deepEqual(options, { userId: 'alice' });
  await controller.listSubmissions(new Request('https://fixture.test/api/submissions'));
  assert.equal(options.viewer.canReview, true);
  assert.equal((await controller.listSubmissions(new Request('https://fixture.test/api/submissions?userId=bob'))).status, 403);
});

test('team submission query uses inner joins and both team filters, hides empty legacy placeholders', async () => {
  const db = database({ submissions: { data: [] } });
  const service = load('backend/services/submissions.service.ts', { ...dbOverrides(db), [networkKey]: {} });
  await service.findSubmissions({ teamId: 'team', viewer: { role: 'admin' } });
  const ops = db.calls[0].ops;
  assert.match(ops.find(([op]) => op === 'select')[1], /users!inner.*tasks!inner/);
  assert.ok(ops.some(([op, key, value]) => op === 'eq' && key === 'tasks.team_id' && value === 'team'));
  assert.ok(ops.some(([op, key, value]) => op === 'eq' && key === 'users.team_id' && value === 'team'));
  assert.ok(ops.some(([op, value]) => op === 'or' && value.includes('media_type.not.is.null')));
});

test('history mapper keeps titles of completed program steps no longer present in active task feed', () => {
  const client = load('frontend/shared/api/client.ts');
  assert.equal(client.mapSubmission({ id: 's', task_id: 'completed', tasks: { title: 'Completed step' } }).taskTitle, 'Completed step');
});

test('notification does not count summary-only delivery as success; failed copy remains retryable', async () => {
  const db = database({
    users: { data: { id: 'mentor', role: 'admin', team_id: 'team', telegram_id: '999' } },
    submissions: { data: { id: 's', status: 'pending', media_type: 'photo', telegram_chat_id: '111', telegram_message_id: '1', users: { name: 'Alice' }, tasks: { title: 'Task' } } },
  });
  let claimed = false;
  db.rpc = async (name) => name === 'tg_can_review' ? { data: true } : { data: claimed ? [] : (claimed = true, [{ id: 'job', kind: 'submission', recipient_id: 'mentor', submission_id: 's', attempts: 1, lock_token: 'lock' }]) };
  const original = global.fetch;
  global.fetch = async (url) => ({ ok: url.endsWith('/sendMessage'), status: url.endsWith('/sendMessage') ? 200 : 400, json: async () => ({ ok: url.endsWith('/sendMessage') }) });
  try {
    const service = load('backend/services/telegram-notifications.service.ts', { ...dbOverrides(db), 'next/server': { after: () => {} }, [envKey]: { serverEnv: { telegramBotToken: 'fixture', appUrl: 'https://fixture.test' } } });
    const result = await service.deliverTelegramNotifications();
    assert.equal(result.delivered, 0); assert.equal(result.failed, 1);
    const patches = db.calls.filter(({ table }) => table === 'telegram_notification_jobs').map(({ ops }) => ops.find(([op]) => op === 'update')[1]);
    assert.ok(patches.some((patch) => patch.summary_sent));
    assert.ok(patches.some((patch) => patch.available_at));
    assert.ok(!patches.some((patch) => patch.delivered_at));
  } finally { global.fetch = original; }
});

test('queued answer is cancelled if rights are revoked between summary and copy', async () => {
  const db = database({
    users: { data: { id: 'mentor', role: 'member', can_review: true, team_id: 'team', telegram_id: '999' } },
    submissions: { data: { id: 's', status: 'pending', media_type: 'text', answer_text: 'Secret', telegram_chat_id: '111', telegram_message_id: '1' } },
  });
  let claimed = false, checks = 0;
  db.rpc = async (name) => name === 'tg_can_review' ? { data: ++checks === 1 } : { data: claimed ? [] : (claimed = true, [{ id: 'job', kind: 'submission', recipient_id: 'mentor', submission_id: 's', attempts: 1, lock_token: 'lock' }]) };
  const requests = [], original = global.fetch;
  global.fetch = async (url) => { requests.push(url); return { ok: true, json: async () => ({ ok: true }) }; };
  try {
    const service = load('backend/services/telegram-notifications.service.ts', { ...dbOverrides(db), 'next/server': { after: () => {} }, [envKey]: { serverEnv: { telegramBotToken: 'fixture' } } });
    await service.deliverTelegramNotifications();
    assert.equal(requests.length, 1); assert.ok(requests[0].endsWith('/sendMessage'));
    assert.ok(db.calls.some(({ table, ops }) => table === 'telegram_notification_jobs' && ops.some(([op, patch]) => op === 'update' && patch.cancelled_at)));
  } finally { global.fetch = original; }
});

test('webhook refuses unauthenticated and mismatched chat updates before saving', async () => {
  let calls = 0;
  const controller = load('backend/controllers/telegram.controller.ts', {
    'next/server': { NextResponse: { json: (data) => ({ data, status: 200 }) } },
    '@/backend/http/api-response': { ok: (data) => data, failure: (message, status) => ({ message, status }) },
    '@/backend/http/auth-guard': {}, ...dbOverrides(null),
    [envKey]: { serverEnv: {}, isValidTelegramSecret: (value) => value === 'fixture' },
    '@/backend/services/telegram-submission.service': { attachTelegramSubmission: async () => { calls++; } },
    '@/backend/services/telegram-link.service': {}, '@/backend/services/telegram-notifications.service': {},
  });
  assert.equal((await controller.receiveTelegramUpdate(new Request('https://fixture.test', { method: 'POST', body: '{}' }))).status, 401);
  const invalid = { update_id: 1, message: { from: { id: 111 }, chat: { id: 222, type: 'private' }, message_id: 1, text: 'Answer' } };
  assert.equal((await controller.receiveTelegramUpdate(new Request('https://fixture.test', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'fixture' }, body: JSON.stringify(invalid) }))).status, 400);
  assert.equal(calls, 0);
});

test('successful Telegram linking sends confirmation followed by the club welcome message', async () => {
  const messages = [];
  const controller = load('backend/controllers/telegram.controller.ts', {
    'next/server': { NextResponse: { json: (data) => ({ data, status: 200 }) } },
    '@/backend/http/api-response': { failure: (message, status) => ({ message, status }) },
    '@/backend/http/auth-guard': {}, ...dbOverrides(null),
    [envKey]: { serverEnv: {}, isValidTelegramSecret: (value) => value === 'fixture' },
    '@/backend/services/telegram-submission.service': { beginTelegramSubmission: async () => ({}) },
    '@/backend/services/telegram-link.service': { linkTelegramAccount: async () => ({ userId: 'alice' }) },
    '@/backend/services/telegram-notifications.service': {
      sendTelegramMessage: async (_chatId, message) => { messages.push(message); return { ok: true }; },
      scheduleTelegramDelivery: () => {},
    },
  });
  const update = {
    update_id: 7,
    message: { from: { id: 111 }, chat: { id: 111, type: 'private' }, message_id: 8, text: '/start link_fixture' },
  };
  const result = await controller.receiveTelegramUpdate(new Request('https://fixture.test', {
    method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'fixture' }, body: JSON.stringify(update),
  }));
  assert.equal(result.status, 200);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /Telegram привязан/);
  assert.equal(messages[1], [
    'Твой помощник в клубе inCruises.',
    '',
    'Пошаговая программа запуска на 14 дней: узнай, как путешествовать больше и дешевле, собирай мили за задания и капитанские звёзды за приглашённых друзей.',
    '',
    'Получи гарантированный бонус 100 $',
  ].join('\n'));
});
