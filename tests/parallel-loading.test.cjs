const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

// Each database request from Almaty to the database costs about a third of a second, so independent
// requests must start together. These tests fail if someone chains them one after another again.
test('task details (files, order, video, questions) are requested at the same time', async () => {
  const started = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = (name, value) => async () => { started.push(name); await gate; return value; };
  const controller = loadTs('backend/controllers/tasks.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'm', role: 'member', teamId: 'team' }) },
    '@/backend/services/member-progress.service': { getMemberTaskFeed: async () => ({ data: [{ id: 't1', publication_type: 'evergreen' }] }) },
    '@/backend/services/task-attachments.service': { listTaskAttachments: pending('attachments', { data: new Map() }) },
    '@/backend/services/task-feed-order.service': { applyTaskFeedOrder: async (rows) => { started.push('order'); await gate; return { data: rows }; } },
    '@/backend/services/task-videos.service': { taskVideoSummaries: pending('videos', new Map([['t1', { status: 'ready', playable: true }]])) },
    '@/backend/services/task-quizzes.service': { taskQuizSummaries: pending('quizzes', new Map([['t1', { questions: 3 }]])) },
  });
  const response = controller.listTasks(new Request('http://localhost/api/tasks?view=member'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(started.sort(), ['attachments', 'order', 'quizzes', 'videos'], 'all four started before any finished');
  release();
  const body = await (await response).json();
  assert.deepEqual(body.tasks[0].quiz, { questions: 3 });
  assert.equal(body.tasks[0].video.playable, true);
});

test('a participant feed asks for the team structure together with the lists', async () => {
  const started = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const query = new Proxy({}, { get(_target, key) { return key === 'then' ? undefined : () => query; } });
  const service = loadTs('backend/services/member-progress.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ from: () => query }) },
    '@/backend/infrastructure/supabase/read-pages': { readPages: async () => { started.push('list'); await gate; return { data: [], error: null }; } },
    '@/backend/services/network.service': { findTeamNetwork: async () => { started.push('network'); await gate; return { data: [] }; }, ancestors: () => new Set(), isAudienceVisible: () => true },
  });
  const feed = service.getMemberTaskFeed('m', 'team');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(started.sort(), ['list', 'list', 'list', 'network']);
  release();
  assert.deepEqual((await feed).data, []);
});
