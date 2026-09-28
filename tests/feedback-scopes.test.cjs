const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./helpers/load-ts.cjs');

const id = '11111111-1111-4111-8111-111111111111';
const member = { id, role: 'member', canReview: false };
const reviewer = { id, role: 'member', canReview: true };

function controller(user, calls) {
  return load('backend/controllers/feedback.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/feedback.service': {
      countFeedback: async (_user, scope) => { calls.push(['count', scope]); return { data: { unread: 0, needsReply: 0 } }; },
      listFeedback: async (_user, scope) => { calls.push(['list', scope]); return { data: [] }; },
      listFeedbackTaskGroups: async () => { calls.push(['groups']); return { data: [] }; },
      listFeedbackForTask: async (_user, key) => { calls.push(['participants', key]); return { data: [] }; },
      getFeedback: async (_id, _user, scope) => { calls.push(['detail', scope]); return { data: { id, events: [] } }; },
      sendFeedback: async (_id, _user, scope) => { calls.push(['send', scope]); return { data: { seq: 1 } }; },
      markFeedbackRead: async (_id, _user, scope) => { calls.push(['read', scope]); return { data: true }; },
    },
    '@/backend/services/telegram-notifications.service': { scheduleTelegramDelivery: () => {} },
  });
}

test('reviewer personal feedback stays personal across list, summary, detail, send and read', async () => {
  const calls = [];
  const api = controller(reviewer, calls);
  assert.equal((await api.feedbackList(new Request('https://example.test/api/feedback'))).status, 200);
  assert.equal((await api.feedbackList(new Request('https://example.test/api/feedback?summary=1'))).status, 200);
  assert.equal((await api.feedbackDetail(new Request('https://example.test/api/feedback/' + id), id)).status, 200);
  assert.equal((await api.feedbackMessage(new Request('https://example.test/api/feedback/' + id, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'Hello', nonce: id }),
  }), id)).status, 200);
  assert.equal((await api.feedbackRead(new Request('https://example.test/api/feedback/' + id + '/read'), id)).status, 200);
  assert.deepEqual(calls, [['list', 'personal'], ['count', 'personal'], ['detail', 'personal'], ['send', 'personal'], ['read', 'personal']]);
});

test('mentor task and participant views are explicit, and ordinary members cannot request them', async () => {
  const calls = [];
  const api = controller(reviewer, calls);
  assert.equal((await api.feedbackList(new Request('https://example.test/api/feedback?scope=mentor&view=tasks'))).status, 200);
  assert.equal((await api.feedbackList(new Request('https://example.test/api/feedback?scope=mentor&taskKey=' + id))).status, 200);
  assert.equal((await api.feedbackDetail(new Request('https://example.test/api/feedback/' + id + '?scope=mentor'), id)).status, 200);
  assert.deepEqual(calls, [['groups'], ['participants', id], ['detail', 'mentor']]);
  const forbidden = controller(member, []);
  assert.equal((await forbidden.feedbackList(new Request('https://example.test/api/feedback?scope=mentor'))).status, 403);
  assert.equal((await forbidden.feedbackDetail(new Request('https://example.test/api/feedback/' + id + '?scope=mentor'), id)).status, 403);
  assert.equal((await forbidden.feedbackList(new Request('https://example.test/api/feedback?scope=personal&view=tasks'))).status, 403);
});

test('feedback keeps one page title and uses a consistent Cyrillic-capable system font', () => {
  const { FeedbackPanel } = load('frontend/features/feedback/FeedbackPanel.tsx');
  const mentorHtml = renderToStaticMarkup(React.createElement(FeedbackPanel, { viewerId: id, mentor: true }));
  const memberHtml = renderToStaticMarkup(React.createElement(FeedbackPanel, { viewerId: id }));
  assert.equal((mentorHtml.match(/Обратная связь/g) || []).length, 0, 'mentor panel duplicates its page heading');
  assert.equal((memberHtml.match(/Обратная связь/g) || []).length, 1, 'member panel lost its heading');
  const css = readFileSync('frontend/features/feedback/FeedbackPanel.module.css', 'utf8');
  assert.match(css, /\.shell\s*\{[^}]*font-family:system-ui/);
  assert.doesNotMatch(css, /'DM Sans'|'Manrope'/);
});
