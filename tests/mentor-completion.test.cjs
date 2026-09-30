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

const taskId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const post = (body) => new Request('https://example.test/api/submissions/mentor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function submissionsController(user, recordResult, calls = []) {
  return load('backend/controllers/submissions.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/submissions.service': {
      recordMentorCompletion: async (input, viewer) => { calls.push({ input, viewer }); return recordResult; },
    },
    '@/backend/services/telegram-submission.service': {},
    '@/backend/services/telegram-notifications.service': { scheduleTelegramDelivery: () => calls.push('delivery') },
    '@/backend/config/env': { serverEnv: {} },
  });
}

test('only reviewers record a completion, and feedback is mandatory', async () => {
  const calls = [];
  const valid = { taskId, memberId, points: 10, comment: 'Good test result' };
  assert.equal((await submissionsController(null, {}, calls).recordCompletion(post(valid))).status, 401);
  assert.equal((await submissionsController({ id: memberId, role: 'member', canReview: false }, {}, calls).recordCompletion(post(valid))).status, 403);
  const reviewer = { id: 'mentor', role: 'member', canReview: true };
  assert.equal((await submissionsController(reviewer, {}, calls).recordCompletion(post({ ...valid, comment: '  ' }))).status, 400);
  assert.equal((await submissionsController(reviewer, {}, calls).recordCompletion(post({ ...valid, memberId: 'nope' }))).status, 400);
  assert.equal((await submissionsController(reviewer, {}, calls).recordCompletion(post({ ...valid, points: -1 }))).status, 400);
  assert.equal(calls.length, 0, 'invalid requests reached the database');
});

test('recorded completion is saved through the service and triggers Telegram delivery', async () => {
  const calls = [];
  const reviewer = { id: 'mentor', role: 'admin' };
  const response = await submissionsController(reviewer, { data: { id: 's', status: 'accepted' } }, calls)
    .recordCompletion(post({ taskId, memberId, points: 7, comment: 'Good test result' }));
  assert.equal(response.status, 201);
  assert.deepEqual(calls[0].input, { taskId, memberId, points: 7, comment: 'Good test result' });
  assert.equal(calls[0].viewer, reviewer);
  assert.ok(calls.includes('delivery'));
});

test('database refusals become clear mentor messages without notifications', async () => {
  const calls = [];
  const reviewer = { id: 'mentor', role: 'admin' };
  const conflict = await submissionsController(reviewer, { validationError: 'Задание у этого участника уже зачтено.' }, calls)
    .recordCompletion(post({ taskId, memberId, points: 7, comment: 'Ok' }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).message, 'Задание у этого участника уже зачтено.');
  const foreign = await submissionsController(reviewer, { forbidden: true }, calls).recordCompletion(post({ taskId, memberId, points: 7, comment: 'Ok' }));
  assert.equal(foreign.status, 403);
  assert.ok(!calls.includes('delivery'));
});

function linkController(user, calls) {
  return load('backend/controllers/task-reminders.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/task-reminders.service': { recordTaskLinkOpen: async (userId, id) => { calls.push([userId, id]); return { data: true }; } },
  });
}

test('only participants register task link opens', async () => {
  const calls = [];
  const request = new Request('https://example.test/api/tasks/x/link-opened', { method: 'POST' });
  assert.equal((await linkController({ id: 'mentor', role: 'admin' }, calls).taskLinkOpened(request, taskId)).status, 200);
  assert.equal((await linkController({ id: memberId, role: 'member' }, calls).taskLinkOpened(request, 'bad')).status, 400);
  assert.equal((await linkController(null, calls).taskLinkOpened(request, taskId)).status, 401);
  const response = await linkController({ id: memberId, role: 'member' }, calls).taskLinkOpened(request, taskId);
  assert.equal((await response.json()).recorded, true);
  assert.deepEqual(calls, [[memberId, taskId]]);
});

function database(results) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, ops: [] }; calls.push(call);
    const query = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (resolve) => Promise.resolve(results[table] || { data: null, error: null }).then(resolve);
      return (...args) => { call.ops.push([key, ...args]); return query; };
    } });
    return query;
  } };
}

async function deliverReminder(due) {
  const db = database({ users: { data: { id: memberId, role: 'member', team_id: 'team', telegram_id: '777' } }, tasks: { data: { title: 'Тест HireBox' } } });
  const rpcCalls = [];
  let claimed = false;
  db.rpc = async (name, args) => {
    rpcCalls.push(name);
    if (name === 'tg_claim_notification') return { data: claimed ? [] : (claimed = true, [{ id: 'job', kind: 'task-reminder', recipient_id: memberId, payload: { taskId }, attempts: 1, lock_token: 'lock' }]) };
    if (name === 'app_task_reminder_due') { assert.deepEqual(args, { p_user: memberId, p_task: taskId }); return { data: due }; }
    return { data: 0 };
  };
  const messages = [], original = global.fetch;
  global.fetch = async (_url, init) => { messages.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  try {
    const service = load('backend/services/telegram-notifications.service.ts', {
      '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db },
      'next/server': { after: () => {} },
      '@/backend/config/env': { serverEnv: { telegramBotToken: 'fixture', appUrl: 'https://prokachka.test' } },
    });
    const result = await service.deliverTelegramNotifications();
    const patches = db.calls.filter(({ table }) => table === 'telegram_notification_jobs').map(({ ops }) => ops.find(([op]) => op === 'update')[1]);
    return { result, messages, patches, rpcCalls };
  } finally { global.fetch = original; }
}

test('reminder names the task and asks to press the send button', async () => {
  const { result, messages, patches, rpcCalls } = await deliverReminder(true);
  assert.equal(result.delivered, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].chat_id, '777');
  assert.match(messages[0].text, /«Тест HireBox»/);
  assert.match(messages[0].text, /Отправить ответ/);
  assert.match(messages[0].text, /https:\/\/prokachka\.test\//);
  assert.ok(patches.some((patch) => patch.delivered_at));
  assert.equal(rpcCalls.at(-1), 'app_queue_task_reminders', 'new reminders are queued after existing jobs');
});

test('reminder is cancelled silently once the work was sent', async () => {
  const { result, messages, patches } = await deliverReminder(false);
  assert.equal(result.delivered, 0);
  assert.equal(messages.length, 0);
  assert.ok(patches.some((patch) => patch.cancelled_at));
});

test('participant sees mentor-recorded work as its own source', () => {
  const client = load('frontend/shared/api/client.ts');
  assert.equal(client.mapSubmission({ id: 's', user_id: 'u', task_id: 't', submission_source: 'mentor', status: 'accepted' }).source, 'mentor');
  assert.equal(client.mapSubmission({ id: 's', user_id: 'u', task_id: 't', submission_source: 'unknown' }).source, 'telegram');
});

test('completion dialog shows the participant, task limit and requires feedback', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const modals = require('./helpers/load-ts.cjs')('frontend/features/admin/AdminModals.tsx', {
    '@/frontend/shared/ResourceCard': { ResourceCard: () => null },
    './TaskFilePicker': { TaskFilePicker: () => null },
  });
  const html = renderToStaticMarkup(React.createElement(modals.CompletionModal, {
    task: { id: taskId, title: 'Тест HireBox', maxPoints: 15 }, memberName: 'Айгерим', draft: { points: '15', comment: '' }, busy: false,
    onChange: () => {}, onClose: () => {}, onSubmit: () => {},
  }));
  assert.match(html, /Айгерим/);
  assert.match(html, /«Тест HireBox»/);
  assert.match(html, /max="15"/);
  assert.match(html, /<textarea[^>]*required/);
  assert.match(html, /<button type="submit"[^>]*disabled/);
});
