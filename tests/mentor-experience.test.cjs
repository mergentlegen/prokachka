const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const HOUR = 3_600_000, DAY = 24 * HOUR;
const now = Date.parse('2026-10-02T12:00:00');
const at = (offset) => new Date(now + offset).toISOString();
const queue = loadTs('frontend/features/admin/review-queue.ts');
const work = (id, extra = {}) => ({ id, userId: 'u1', taskId: 't1', status: 'pending', points: 0, comment: '', submittedAt: at(-HOUR), reviewVersion: 0, ...extra });
const person = (id, extra = {}) => ({ id, name: id, role: 'member', createdAt: at(-60 * DAY), teamJoinedAt: at(-60 * DAY), ...extra });

test('review queue puts the longest-waiting work first and colours the wait', () => {
  const list = queue.reviewQueue([work('new', { submittedAt: at(-HOUR) }), work('done', { status: 'accepted', submittedAt: at(-9 * DAY) }), work('old', { submittedAt: at(-3 * DAY) })]);
  assert.deepEqual(list.map((item) => item.id), ['old', 'new']);
  assert.deepEqual(queue.waitingInfo(at(-3 * DAY), now), { text: 'ждёт 3 дня', tone: 'late' });
  assert.deepEqual(queue.waitingInfo(at(-30 * HOUR), now), { text: 'ждёт 1 день', tone: 'waiting' });
  assert.deepEqual(queue.waitingInfo(at(-5 * HOUR), now), { text: 'ждёт 5 ч', tone: 'fresh' });
  assert.equal(queue.waitingInfo(at(-60_000), now).text, 'только что');
});

test('quiet members: joined two weeks ago or earlier and sent nothing for 14 days', () => {
  const users = [person('active'), person('quiet'), person('newbie', { teamJoinedAt: at(-3 * DAY) }), person('lead', { role: 'admin' })];
  const sent = [work('a', { userId: 'active', submittedAt: at(-2 * DAY) }), work('b', { userId: 'quiet', submittedAt: at(-20 * DAY) })];
  assert.deepEqual(queue.quietMembers(users, sent, now).map((user) => user.id), ['quiet']);
  assert.deepEqual(queue.newMembers(users, now).map((user) => user.id), ['newbie']);
});

test('activity chart counts works per local day for the last 14 days', () => {
  const days = queue.dailyActivity([work('a', { submittedAt: at(-HOUR) }), work('b', { submittedAt: at(-2 * HOUR) }), work('c', { submittedAt: at(-DAY) }), work('old', { submittedAt: at(-20 * DAY) })], 14, now);
  assert.equal(days.length, 14);
  assert.equal(days[13].count, 2);
  assert.equal(days[12].count, 1);
  assert.equal(days.reduce((sum, day) => sum + day.count, 0), 3, 'older works are outside the window');
});

test('weekly leaders sum miles accepted in the last 7 days', () => {
  const users = [person('anna', { name: 'Анна' }), person('boris', { name: 'Борис' })];
  const leaders = queue.weeklyLeaders([
    work('1', { userId: 'anna', status: 'accepted', points: 30, reviewedAt: at(-DAY) }),
    work('2', { userId: 'boris', status: 'accepted', points: 50, reviewedAt: at(-2 * DAY) }),
    work('3', { userId: 'anna', status: 'accepted', points: 40, reviewedAt: at(-3 * DAY) }),
    work('4', { userId: 'boris', status: 'accepted', points: 99, reviewedAt: at(-9 * DAY) }),
    work('5', { userId: 'anna', status: 'pending', points: 10 }),
  ], users, now);
  assert.deepEqual(leaders.map(({ user, miles }) => [user.id, miles]), [['anna', 70], ['boris', 50]]);
});

function templatesController(user, service = {}) {
  return loadTs('backend/controllers/review-templates.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/review-templates.service': { REVIEW_TEMPLATE_LIMIT: 12, REVIEW_TEMPLATE_MAX_LENGTH: 300, findReviewTemplates: async () => ({ data: ['Отлично'] }), replaceReviewTemplates: async (_id, list) => ({ data: list }), ...service },
  });
}
const put = (body) => new Request('https://example.test/api/review-templates', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('shared comments: reviewers read them, only the team leader changes them', async () => {
  assert.equal((await templatesController({ id: 'm', role: 'member', teamId: 'team' }).listReviewTemplates(new Request('https://example.test'))).status, 403);
  const reviewer = await (await templatesController({ id: 'r', role: 'member', teamId: 'team', canReview: true }).listReviewTemplates(new Request('https://example.test'))).json();
  assert.deepEqual(reviewer, { ok: true, templates: ['Отлично'], canEdit: false });
  const leader = await (await templatesController({ id: 'l', role: 'admin', teamId: 'team' }).listReviewTemplates(new Request('https://example.test'))).json();
  assert.equal(leader.canEdit, true);

  assert.equal((await templatesController({ id: 'r', role: 'member', teamId: 'team', canReview: true }).saveReviewTemplates(put({ templates: ['x'] }))).status, 403);
  assert.equal((await templatesController(null).saveReviewTemplates(put({ templates: [] }))).status, 401);
  const calls = [];
  const saved = await templatesController({ id: 'l', role: 'admin', teamId: 'team' }, { replaceReviewTemplates: async (id, list) => { calls.push([id, list]); return { data: list }; } }).saveReviewTemplates(put({ templates: ['Хорошо', 'Ещё'] }));
  assert.equal(saved.status, 200);
  assert.deepEqual(calls, [['l', ['Хорошо', 'Ещё']]]);
  assert.equal((await templatesController({ id: 'l', role: 'admin', teamId: 'team' }).saveReviewTemplates(put({ templates: 'Хорошо' }))).status, 400);
  assert.equal((await templatesController({ id: 'l', role: 'admin', teamId: 'team' }).saveReviewTemplates(put({ templates: [42] }))).status, 400);
  const invalid = await templatesController({ id: 'l', role: 'admin', teamId: 'team' }, { replaceReviewTemplates: async () => ({ validationError: 'Можно сохранить не больше 12 комментариев.' }) }).saveReviewTemplates(put({ templates: ['a'] }));
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).message, /не больше 12/);
});

const store = {
  users: [person('u1', { name: 'Анна Ким' })], tasks: [{ id: 't1', title: 'Видео-приветствие', maxPoints: 30, isActive: true, createdAt: at(-DAY), updatedAt: at(-DAY) }],
  submissions: [], programs: [], programProgress: [], announcements: [], starAwards: [],
};

test('review window shows the answer and the decision together, with shared or default comments', () => {
  const { ReviewFlow, DEFAULT_REVIEW_TEMPLATES } = loadTs('frontend/features/admin/ReviewFlow.tsx', { '@/frontend/shared/ModalSheet': { ModalSheet: ({ children }) => React.createElement('div', null, children) } });
  const items = [work('w1', { answerText: 'Мой ответ', submittedAt: new Date(Date.now() - 3 * DAY - HOUR).toISOString() }), work('w2')];
  const render = (props) => renderToStaticMarkup(React.createElement(ReviewFlow, { queue: items, startId: 'w1', store, templates: [], canEditTemplates: false, onSave: async () => true, onEditTemplates() {}, onClose() {}, ...props }));
  const markup = render();
  assert.match(markup, /2 работы ждут проверки/);
  assert.match(markup, /Анна Ким/);
  assert.match(markup, /Мой ответ/);
  assert.match(markup, /ждёт 3 дня/);
  assert.match(markup, /value="30"/, 'miles default to the task maximum');
  assert.match(markup, /Принять · 30 миль/);
  assert.match(markup, /На доработку/);
  assert.match(markup, /Пропустить, проверю позже/);
  for (const text of DEFAULT_REVIEW_TEMPLATES) assert.ok(markup.includes(text), 'defaults are offered while the team has none');
  assert.ok(!markup.includes('Настроить'));
  const leader = render({ templates: ['Свой комментарий'], canEditTemplates: true });
  assert.match(leader, /Свой комментарий/);
  assert.ok(!leader.includes(DEFAULT_REVIEW_TEMPLATES[0]));
  assert.match(leader, /Настроить/);
  assert.match(render({ queue: [], startId: 'gone' }), /Нет работ на проверку/);
});

test('mentor overview lists only what needs attention, or a calm state', () => {
  const { AdminDashboard } = loadTs('frontend/features/admin/AdminDashboard.tsx');
  const busy = renderToStaticMarkup(React.createElement(AdminDashboard, { store, queue: [work('w1', { submittedAt: at(-3 * DAY) }), work('w2')], feedbackNeedsReply: 3, requests: 0, canReview: true, now, onNavigate() {} }));
  assert.match(busy, /работы ждут проверки/);
  assert.match(busy, /самая старая ждёт 3 дня/);
  assert.match(busy, /переписки без ответа/);
  assert.ok(!busy.includes('заявк'), 'empty tiles are hidden');
  assert.match(busy, /участник затих/, 'Анна sent nothing for two weeks');
  assert.equal((busy.match(/aria-label="[^"]+: \d+ работ[аы]?"/g) || []).length, 14, 'one column per day');
  assert.match(busy, /<caption>Работы по дням<\/caption>/);
  const calm = renderToStaticMarkup(React.createElement(AdminDashboard, { store: { ...store, users: [] }, queue: [], feedbackNeedsReply: 0, requests: 0, canReview: true, now, onNavigate() {} }));
  assert.match(calm, /Всё под контролем/);
  const publisher = renderToStaticMarkup(React.createElement(AdminDashboard, { store, queue: [], feedbackNeedsReply: 0, requests: 0, canReview: false, now, onNavigate() {} }));
  assert.ok(!publisher.includes('Требует внимания'), 'publish-only mentors do not see review tiles');
});

test('task progress counts who answered, what waits and who is missing', () => {
  const { taskParticipantResults, taskProgress } = loadTs('frontend/features/admin/task-results.ts');
  const users = [person('a'), person('b'), person('c'), person('d'), person('lead', { role: 'admin' })];
  const task = { id: 't', title: 'T', deadlineAt: at(-DAY), isActive: true };
  const submissions = [work('1', { userId: 'a', taskId: 't', status: 'accepted' }), work('2', { userId: 'b', taskId: 't', status: 'pending' }), work('3', { userId: 'c', taskId: 't', status: 'revision' })];
  const results = taskParticipantResults(task, { users, submissions }, now);
  assert.deepEqual(results.map((item) => [item.user.id, item.status]), [['a', 'accepted'], ['b', 'pending'], ['c', 'revision'], ['d', 'overdue']]);
  assert.deepEqual(taskProgress(results), { total: 4, sent: 3, accepted: 1, pending: 1, revision: 1, missing: 1 });
});

test('program funnel shows how many participants stand on each step and who finished', () => {
  const { programFunnel } = loadTs('frontend/features/admin/ProgramsPanel.tsx', { './AdminViews': {} });
  const steps = [{ id: 's1', title: 'Знакомство', position: 1 }, { id: 's2', title: 'Контакты', position: 2 }, { id: 's3', title: 'Встреча', position: 3 }];
  const progress = { members: [{ status: 'active', currentStep: 1 }, { status: 'late', currentStep: 2 }, { status: 'missed', currentStep: 2 }, { status: 'completed' }] };
  const funnel = programFunnel(progress, steps);
  assert.deepEqual(funnel.rows.map((row) => row.count), [1, 2, 0]);
  assert.equal(funnel.completed, 1);
  assert.equal(funnel.total, 4);
  assert.equal(programFunnel(undefined, steps).total, 0);
});

test('conversation header reads the latest work status from the thread history', () => {
  const { latestWorkStatus } = loadTs('frontend/features/feedback/FeedbackPanel.tsx');
  const event = (kind, submissionId, reviewStatus = null) => ({ id: kind + submissionId + reviewStatus, kind, submissionId, reviewStatus });
  assert.deepEqual(latestWorkStatus([event('submission', 's1')]), { submissionId: 's1', status: 'pending', label: 'Ждёт проверки' });
  assert.equal(latestWorkStatus([event('submission', 's1'), event('review', 's1', 'revision')]).label, 'На доработке');
  assert.deepEqual(latestWorkStatus([event('submission', 's1'), event('review', 's1', 'revision'), event('submission', 's2')]).submissionId, 's2', 'a resubmission is waiting again');
  assert.equal(latestWorkStatus([event('submission', 's1'), event('review', 's1', 'accepted'), { id: 'm', kind: 'message', submissionId: null }]).status, 'accepted');
  assert.equal(latestWorkStatus([{ id: 'm', kind: 'message', submissionId: null }]), null);
});

test('join requests show the inviter and offer "accept everyone" only for several people', () => {
  const { RequestsPanel } = loadTs('frontend/features/admin/RequestsPanel.tsx', { '@/frontend/shared/ConfirmModal': { ConfirmModal: () => null } });
  const request = (id, extra = {}) => ({ id, userId: 'n' + id, teamId: 'team', status: 'pending', createdAt: at(-5 * HOUR), userName: 'Новичок ' + id, ...extra });
  const users = [person('u0', { name: 'Анна Ким' })];
  const two = renderToStaticMarkup(React.createElement(RequestsPanel, { requests: [request('1', { invitedByUserId: 'u0' }), request('2')], users, onReview: async () => true }));
  assert.match(two, /Пригласил\(а\): <b>Анна Ким<\/b>/);
  assert.match(two, /Сам\(а\) выбрал\(а\) команду/);
  assert.match(two, /2 заявки ждут решения/);
  assert.match(two, /Принять всех/);
  const one = renderToStaticMarkup(React.createElement(RequestsPanel, { requests: [request('1')], users, onReview: async () => true }));
  assert.ok(!one.includes('Принять всех'));
  assert.match(renderToStaticMarkup(React.createElement(RequestsPanel, { requests: [], users, onReview: async () => true })), /Новых заявок нет/);
});
