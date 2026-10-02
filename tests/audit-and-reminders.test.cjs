const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

const taskId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const announcementId = '33333333-3333-4333-8333-333333333333';
const teamId = '44444444-4444-4444-8444-444444444444';

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

// Runs the delivery worker over the given jobs and records what reached Telegram.
async function deliver(jobs, { results = {}, rpc = {} } = {}) {
  const db = database({ users: { data: { id: memberId, role: 'member', team_id: teamId, telegram_id: '777', first_name: 'Анна', teams: { name: 'Команда Асель' } } }, ...results });
  const queue = [...jobs];
  const rpcCalls = [];
  db.rpc = async (name, args) => {
    rpcCalls.push([name, args]);
    if (name === 'tg_claim_notification') { const job = queue.shift(); return { data: job ? [{ attempts: 1, lock_token: 'lock', recipient_id: memberId, payload: {}, ...job }] : [] }; }
    if (name in rpc) return { data: rpc[name] };
    return { data: 0 };
  };
  const messages = [], original = global.fetch;
  global.fetch = async (_url, init) => { messages.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  try {
    const service = loadTs('backend/services/telegram-notifications.service.ts', {
      '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db },
      'next/server': { after: () => {} },
      '@/backend/config/env': { serverEnv: { telegramBotToken: 'fixture', appUrl: 'https://prokachka.test' } },
    });
    const result = await service.deliverTelegramNotifications();
    const patches = db.calls.filter(({ table }) => table === 'telegram_notification_jobs').map(({ ops }) => ops.find(([op]) => op === 'update')[1]);
    return { result, messages, patches, rpcCalls };
  } finally { global.fetch = original; }
}

test('a mentor nudge names the task, its deadline and opens the task list', async () => {
  const { result, messages } = await deliver([{ id: 'n1', kind: 'task-nudge', payload: { taskId } }], {
    results: { tasks: { data: { title: 'Видео-приветствие', deadline_at: '2026-10-05T13:00:00Z' } } }, rpc: { app_task_nudge_due: true },
  });
  assert.equal(result.delivered, 1);
  assert.match(messages[0].text, /Наставник напоминает о задании «Видео-приветствие»/);
  assert.match(messages[0].text, /до 5 октября в 18:00/, 'deadline is shown in Almaty time');
  assert.match(messages[0].text, /https:\/\/prokachka\.test\/\?tab=tasks/);
});

test('a nudge is dropped when the participant answered after the mentor pressed the button', async () => {
  const { result, messages, patches } = await deliver([{ id: 'n1', kind: 'task-nudge', payload: { taskId } }], { rpc: { app_task_nudge_due: false } });
  assert.equal(result.delivered, 0);
  assert.equal(messages.length, 0);
  assert.ok(patches.some((patch) => patch.cancelled_at));
});

test('an announcement reaches Telegram with its title, text and link; hidden ones are not sent', async () => {
  const results = { announcements: { data: { title: 'Встреча в пятницу', content: 'Собираемся в 19:00 в Zoom.', resource_url: 'https://zoom.us/j/1', photos: [{ id: 'p' }], teams: { name: 'Команда Асель' } } } };
  const sent = await deliver([{ id: 'a1', kind: 'announcement', payload: { announcementId } }], { results, rpc: { app_announcement_recipient_ok: true } });
  assert.equal(sent.result.delivered, 1);
  const text = sent.messages[0].text;
  assert.match(text, /^📢 Объявление команды «Команда Асель»\n\nВстреча в пятницу\n\nСобираемся в 19:00 в Zoom\./);
  assert.match(text, /Ссылка: https:\/\/zoom\.us\/j\/1/);
  assert.match(text, /Фото — в объявлении на сайте/);
  const hidden = await deliver([{ id: 'a1', kind: 'announcement', payload: { announcementId } }], { results, rpc: { app_announcement_recipient_ok: false } });
  assert.equal(hidden.messages.length, 0);
  assert.ok(hidden.patches.some((patch) => patch.cancelled_at));
});

test('a start reminder greets the participant by name and is cancelled after the first answer', async () => {
  const sent = await deliver([{ id: 's1', kind: 'start-reminder', payload: { step: 1 } }], { rpc: { app_start_reminder_due: true } });
  assert.equal(sent.result.delivered, 1);
  assert.match(sent.messages[0].text, /Анна, добро пожаловать/);
  assert.match(sent.messages[0].text, /команде «Команда Асель»/);
  assert.match(sent.messages[0].text, /\?tab=tasks/);
  const done = await deliver([{ id: 's1', kind: 'start-reminder', payload: { step: 2 } }], { rpc: { app_start_reminder_due: false } });
  assert.equal(done.messages.length, 0);
  assert.ok(done.patches.some((patch) => patch.cancelled_at));
});

test('one worker run sends at most 20 messages', async () => {
  const jobs = Array.from({ length: 30 }, (_, index) => ({ id: 'n' + index, kind: 'task-nudge', payload: { taskId } }));
  const { rpcCalls } = await deliver(jobs, { rpc: { app_task_nudge_due: false } });
  assert.equal(rpcCalls.filter(([name]) => name === 'tg_claim_notification').length, 20);
});

test('start reminder texts and the Almaty daytime window', () => {
  const { startReminderText, isAlmatyDaytime } = loadTs('backend/services/telegram-notifications.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => null }, 'next/server': { after: () => {} }, '@/backend/config/env': { serverEnv: {} },
  });
  const texts = [1, 2, 3].map((step) => startReminderText(step, 'Анна', 'Команда', 'https://x.test/?tab=tasks'));
  assert.equal(new Set(texts).size, 3, 'each reminder says something new');
  assert.match(texts[2], /напишите своему наставнику/);
  assert.match(startReminderText(2, '', 'Команда', ''), /^Задания команды/, 'works without a name and a link');
  assert.equal(isAlmatyDaytime(new Date('2026-10-03T05:00:00Z')), true, '10:00 in Almaty');
  assert.equal(isAlmatyDaytime(new Date('2026-10-03T04:59:00Z')), false);
  assert.equal(isAlmatyDaytime(new Date('2026-10-03T14:59:00Z')), true, '19:59 in Almaty');
  assert.equal(isAlmatyDaytime(new Date('2026-10-03T15:00:00Z')), false);
});

test('nudge endpoint: mentors only, sending is recorded in the journal and wakes the worker', async () => {
  const calls = [], audits = [];
  let deliveries = 0, actor = null, answer = { data: { reachable: 3, unreachable: 1, queued: 3, lastSentAt: null, nextAllowedAt: null } };
  const controller = loadTs('backend/controllers/task-nudges.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => actor },
    '@/backend/services/task-nudges.service': { taskNudge: async (...args) => { calls.push(args); return answer; } },
    '@/backend/services/telegram-notifications.service': { scheduleTelegramDelivery: () => deliveries++ },
    '@/backend/services/audit-log.service': { auditRecord: async () => ({ label: 'Видео', teamId }), recordAudit: async (...args) => audits.push(args) },
  });
  const req = (method) => new Request('http://localhost/api/tasks/' + taskId + '/nudge', { method });
  assert.equal((await controller.previewTaskNudge(req('GET'), taskId)).status, 401);
  actor = { id: memberId, role: 'member', teamId, canReview: false, canPublishTasks: false };
  assert.equal((await controller.sendTaskNudge(req('POST'), taskId)).status, 403);
  actor = { id: memberId, role: 'admin', teamId, name: 'Асель' };
  assert.equal((await controller.previewTaskNudge(req('GET'), 'bad')).status, 400);
  const preview = await controller.previewTaskNudge(req('GET'), taskId);
  assert.equal(preview.status, 200);
  assert.deepEqual(calls.at(-1), [memberId, taskId, false]);
  assert.equal(deliveries, 0);
  assert.equal(audits.length, 0, 'a preview is not an action');
  const sent = await controller.sendTaskNudge(req('POST'), taskId);
  assert.equal((await sent.json()).nudge.queued, 3);
  assert.deepEqual(calls.at(-1), [memberId, taskId, true]);
  assert.equal(deliveries, 1);
  assert.equal(audits[0][1].action, 'task.nudge');
  assert.deepEqual(audits[0][1].details, { recipients: 3 });
  answer = { validationError: 'По этому заданию уже напоминали.' };
  const repeated = await controller.sendTaskNudge(req('POST'), taskId);
  assert.equal(repeated.status, 409);
  assert.match((await repeated.json()).message, /уже напоминали/);
});

test('the journal is for the CEO only and pages by id', async () => {
  let actor = null, asked;
  const rows = Array.from({ length: 61 }, (_, index) => ({ id: 100 - index }));
  const controller = loadTs('backend/controllers/ceo-journal.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => actor },
    '@/backend/services/audit-log.service': { findAuditLog: async (options) => { asked = options; return { data: rows }; } },
  });
  const req = (query = '') => new Request('http://localhost/api/ceo/journal' + query);
  assert.equal((await controller.getCeoJournal(req())).status, 401);
  actor = { id: 'm', role: 'admin' };
  assert.equal((await controller.getCeoJournal(req())).status, 403);
  actor = { id: 'ceo', role: 'ceo' };
  assert.equal((await controller.getCeoJournal(req('?before=abc'))).status, 400);
  const page = await (await controller.getCeoJournal(req('?before=500'))).json();
  assert.deepEqual(asked, { before: 500, limit: 61 });
  assert.equal(page.entries.length, 60);
  assert.equal(page.hasMore, true);
});

test('journal writes never break the action and the CEO login is named CEO', async () => {
  const sent = [];
  const service = (rpc) => loadTs('backend/services/audit-log.service.ts', { '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc }) } });
  await service(async (name, args) => { sent.push([name, args]); return { error: null }; }).recordAudit({ id: 'ceo', name: 'Админ', role: 'ceo' }, { action: 'team.delete', targetId: teamId, targetLabel: 'Старая', teamId: 'not-a-uuid' });
  assert.equal(sent[0][0], 'app_record_audit');
  assert.equal(sent[0][1].p_actor_id, null);
  assert.equal(sent[0][1].p_actor_name, 'CEO');
  assert.equal(sent[0][1].p_team_id, null);
  await service(async () => { throw new Error('offline'); }).recordAudit({ id: memberId, name: 'Асель', role: 'admin' }, { action: 'task.delete' });
});

test('journal entries read as plain sentences and filter by kind, team and text', () => {
  const { describeJournalEntry, filterJournal, groupJournalByDay, journalMoment } = loadTs('frontend/features/ceo/journal-format.ts');
  const now = Date.parse('2026-10-03T09:00:00Z');
  const entry = (id, action, extra = {}) => ({ id, action, actorName: 'Асель', actorRole: 'admin', createdAt: '2026-10-03T08:00:00Z', details: {}, ...extra });
  const access = describeJournalEntry(entry(1, 'user.access', { targetLabel: 'Иван', details: { role: ['member', 'admin'], team: ['А', null] } }));
  assert.equal(access.title, 'Изменён доступ');
  assert.deepEqual(access.lines, ['Роль: Участник → Наставник', 'Команда: А → без команды']);
  assert.equal(describeJournalEntry(entry(2, 'user.delete')).tone, 'danger');
  assert.deepEqual(describeJournalEntry(entry(3, 'star.award', { details: { stars: 2, kind: 'classic' } })).lines, ['+2 ★ · Classic']);
  assert.deepEqual(describeJournalEntry(entry(4, 'announcement.create', { details: { telegram: 5 } })).lines, ['В Telegram: 5 участникам']);
  const entries = [
    entry(5, 'task.nudge', { teamId: 'a', targetLabel: 'Видео', details: { recipients: 2 } }),
    entry(6, 'announcement.create', { teamId: 'b', details: { telegram: 3 } }),
    entry(7, 'announcement.create', { teamId: 'b', targetLabel: 'Без рассылки' }),
    entry(8, 'team.disable', { createdAt: '2026-10-02T08:00:00Z', targetLabel: 'Старая' }),
  ];
  const ids = (options) => filterJournal(entries, { query: '', filter: 'all', teamId: '', ...options }).map((item) => item.id);
  assert.deepEqual(ids({ filter: 'messages' }), [5, 6]);
  assert.deepEqual(ids({ filter: 'content' }), [7]);
  assert.deepEqual(ids({ teamId: 'b' }), [6, 7]);
  assert.deepEqual(ids({ query: 'видео' }), [5]);
  assert.deepEqual(groupJournalByDay(entries, now).map((group) => [group.label, group.entries.length]), [['Сегодня', 3], ['Вчера', 1]]);
  assert.equal(journalMoment('2026-10-02T08:00:00Z', true, now), 'вчера, 13:00');
});

test('mentor messages after publishing and the nudge block states', () => {
  const { telegramNotice } = loadTs('frontend/features/admin/AnnouncementsPanel.tsx');
  assert.equal(telegramNotice(undefined), '');
  assert.match(telegramNotice(0), /отправлять некому/);
  assert.match(telegramNotice(-1), /не удалось/);
  assert.equal(telegramNotice(5), 'Объявление опубликовано. В Telegram получат 5 участников.');
  assert.match(telegramNotice(45), /45 участников — в течение 3 мин\./, '20 messages a minute');
  const { nudgeView } = loadTs('frontend/features/admin/TaskNudge.tsx');
  const now = Date.parse('2026-10-03T09:00:00Z');
  assert.equal(nudgeView(null, now).kind, 'loading');
  assert.equal(nudgeView({ reachable: 0, unreachable: 2, queued: 0, lastSentAt: null, nextAllowedAt: null }, now).kind, 'nobody');
  assert.equal(nudgeView({ reachable: 4, unreachable: 0, queued: 0, lastSentAt: null, nextAllowedAt: null }, now).kind, 'ready');
  assert.equal(nudgeView({ reachable: 4, unreachable: 0, queued: 0, lastSentAt: '2026-10-03T08:00:00Z', nextAllowedAt: '2026-10-03T20:00:00Z' }, now).kind, 'cooldown');
  assert.equal(nudgeView({ reachable: 4, unreachable: 0, queued: 0, lastSentAt: '2026-10-02T08:00:00Z', nextAllowedAt: '2026-10-02T20:00:00Z' }, now).kind, 'ready', 'the pause is over');
});
