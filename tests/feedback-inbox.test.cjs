const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const loadTs = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');

const id = '11111111-1111-4111-8111-111111111111';
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const at = (offset) => new Date(now + offset).toISOString();

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return text(tree.props?.children);
}
const button = (tree, label) => nodes(tree, (node) => node.type === 'button' && text(node).includes(label))[0];

function controller(user, calls) {
  return loadTs('backend/controllers/feedback.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/feedback.service': {
      countFeedback: async () => ({ data: {} }), listFeedback: async () => ({ data: [] }), listFeedbackTaskGroups: async () => ({ data: [] }),
      listFeedbackForTask: async () => ({ data: [] }), getFeedback: async () => ({ data: {} }), sendFeedback: async () => ({ data: {} }), markFeedbackRead: async () => ({ data: true }),
      listMentorThreads: async (_user, query, offset, onlyReply) => { calls.push(['inbox', query, offset, onlyReply]); return { data: [] }; },
      dismissFeedbackReply: async (threadId) => { calls.push(['dismiss', threadId]); return { data: true }; },
    },
    '@/backend/services/telegram-notifications.service': { scheduleTelegramDelivery: () => {} },
  });
}

test('the waiting list and the name search across tasks are for mentors only', async () => {
  const calls = [];
  const api = controller({ id, role: 'member', canReview: true }, calls);
  assert.equal((await api.feedbackList(new Request('https://example.test/api/feedback?scope=mentor&view=inbox&filter=reply'))).status, 200);
  assert.equal((await api.feedbackList(new Request('https://example.test/api/feedback?scope=mentor&view=inbox&q=%20%D0%A2%D0%B8%D0%BC%20'))).status, 200);
  assert.equal((await api.feedbackList(new Request('https://example.test/api/feedback?scope=mentor&view=inbox&q=' + 'а'.repeat(81)))).status, 400);
  assert.deepEqual(calls, [['inbox', '', 0, true], ['inbox', 'Тим', 0, false]]);
  const member = controller({ id, role: 'member', canReview: false }, []);
  assert.equal((await member.feedbackList(new Request('https://example.test/api/feedback?scope=mentor&view=inbox'))).status, 403);
  assert.equal((await member.feedbackList(new Request('https://example.test/api/feedback?view=inbox'))).status, 403);
});

test('«Ответ не нужен» is refused to participants and passed through for mentors', async () => {
  const calls = [];
  const mentor = controller({ id, role: 'admin' }, calls);
  assert.equal((await mentor.feedbackDismiss(new Request('https://example.test/api/feedback/' + id + '/dismiss?scope=mentor', { method: 'POST' }), id)).status, 200);
  assert.equal((await mentor.feedbackDismiss(new Request('https://example.test/api/feedback/x/dismiss?scope=mentor', { method: 'POST' }), 'x')).status, 400);
  assert.deepEqual(calls, [['dismiss', id]]);
  const member = controller({ id, role: 'member', canReview: false }, []);
  assert.equal((await member.feedbackDismiss(new Request('https://example.test/api/feedback/' + id + '/dismiss?scope=mentor', { method: 'POST' }), id)).status, 403);
  assert.equal((await member.feedbackDismiss(new Request('https://example.test/api/feedback/' + id + '/dismiss', { method: 'POST' }), id)).status, 403);
});

test('times read like a messenger', () => {
  const { dayLabel, listTime, waitingLabel } = loadTs('frontend/features/feedback/FeedbackPanel.tsx');
  const noon = new Date(2026, 9, 16, 12, 0).getTime();
  assert.equal(dayLabel(new Date(2026, 9, 16, 8, 30).toISOString(), noon), 'Сегодня');
  assert.equal(dayLabel(new Date(2026, 9, 15, 23, 50).toISOString(), noon), 'Вчера');
  assert.equal(dayLabel(new Date(2026, 9, 3, 10, 0).toISOString(), noon), '3 октября');
  assert.match(dayLabel(new Date(2025, 11, 30, 10, 0).toISOString(), noon), /30 декабря 2025/);
  assert.equal(listTime(new Date(2026, 9, 16, 8, 5).toISOString(), noon), '08:05');
  assert.equal(listTime(new Date(2026, 9, 15, 8, 5).toISOString(), noon), 'вчера');
  assert.equal(waitingLabel(new Date(noon - 20 * 60000).toISOString(), noon), 'ждёт 20 мин');
  assert.equal(waitingLabel(new Date(noon - 3 * 3600000).toISOString(), noon), 'ждёт 3 ч');
  assert.equal(waitingLabel(new Date(noon - 2 * DAY).toISOString(), noon), 'ждёт 2 дня');
  assert.equal(waitingLabel(new Date(noon - 5 * DAY).toISOString(), noon), 'ждёт 5 дней');
});

const people = [{ id: 'u2', name: 'Тимур Ахметов' }, { id: 'lead', name: 'Асель Нурланова', avatarUrl: 'https://cdn.test/a.webp' }];
const event = (seq, kind, authorId, extra = {}) => ({ id: 'e' + seq, seq, kind, submissionId: kind === 'message' ? null : 's1', authorId, authorName: people.find((person) => person.id === authorId)?.name || '', body: 'Текст ' + seq, reviewStatus: null, points: null, createdAt: at(-2 * DAY + seq * 60000), ...extra });
const waitingThread = { id: 'th1', taskId: 't1', taskTitle: 'Видео-приветствие', memberId: 'u2', memberName: 'Тимур Ахметов', lastAt: at(-DAY), lastKind: 'message', lastBody: 'Посмотрите', needsReply: true, unread: true, lastSeq: 3, waitingSince: at(-2 * DAY - 3600000) };

function panel(responses, calls) {
  const harness = hookHarness();
  const request = async (url, options = {}) => {
    calls.push([url, options.method || 'GET']);
    const match = Object.keys(responses).find((prefix) => url.startsWith(prefix));
    if (!match) throw new Error('unexpected ' + url);
    return responses[match];
  };
  const { FeedbackPanel } = loadTs('frontend/features/feedback/FeedbackPanel.tsx', { react: { ...React, ...harness.react }, '@/frontend/shared/api/client': { request } });
  return { harness, FeedbackPanel };
}

test('mentor: who waits longest is listed with the wait, and the conversation has decisions, «Ответ не нужен» and «Прочитано»', async () => {
  const calls = [], reviews = [];
  let changed = 0;
  const detail = { id: 'th1', taskId: 't1', taskTitle: 'Видео-приветствие', memberId: 'u2', memberName: 'Тимур Ахметов', people, needsReply: true, memberSeenSeq: 3,
    events: [event(1, 'submission', 'u2'), event(2, 'message', 'lead'), event(3, 'message', 'u2')] };
  const { harness, FeedbackPanel } = panel({
    '/api/feedback?scope=mentor&view=inbox&filter=reply': { threads: [waitingThread] },
    '/api/feedback?scope=mentor&view=tasks': { groups: [{ key: 't1', title: 'Видео-приветствие', participants: 3, needsReply: 1, unread: 1, lastAt: at(-DAY) }] },
    '/api/feedback/th1/read': { read: true },
    '/api/feedback/th1/dismiss': { dismissed: true },
    '/api/feedback/th1?scope=mentor': { thread: detail },
  }, calls);
  let tree = harness.mount(FeedbackPanel, { viewerId: 'lead', mentor: true, onReview: (...args) => reviews.push(args), onChange: () => { changed++; } });
  try {
    tree = await harness.settle();
    assert.match(text(button(tree, 'Ждут ответа')), /Ждут ответа1/);
    const row = button(tree, 'Тимур Ахметов');
    assert.match(text(row), /Видео-приветствие/, 'the task is named in the cross-task list');
    assert.match(text(row), /ждёт 2 дня/);
    row.props.onClick();
    tree = await harness.settle();
    assert.ok(calls.some(([url, method]) => url === '/api/feedback/th1/read?scope=mentor' && method === 'POST'), 'opening marks the conversation read');
    button(tree, 'Принять').props.onClick();
    button(tree, 'На доработку').props.onClick();
    assert.deepEqual(reviews, [['s1', 'accepted'], ['s1', 'revision']]);
    assert.ok(nodes(tree, (node) => node.type === 'small' && text(node) === '✓✓ Прочитано').length === 1, 'read receipt under the mentor message');
    const { dayLabel } = loadTs('frontend/features/feedback/FeedbackPanel.tsx');
    const label = dayLabel(detail.events[0].createdAt);
    assert.equal(nodes(tree, (node) => node.type === 'span' && text(node) === label).length, 1, 'one day separator for messages of the same day');
    button(tree, 'Ответ не нужен').props.onClick();
    tree = await harness.settle();
    assert.ok(calls.some(([url, method]) => url === '/api/feedback/th1/dismiss?scope=mentor' && method === 'POST'));
    assert.equal(changed, 1, 'the mentor counter is refreshed');
  } finally { harness.unmount(); }
});

test('participant: the mentor with photo in the header and «Исправить работу» when the work went back', async () => {
  const calls = [], opened = [];
  const detail = { id: 'th1', taskId: 't1', taskTitle: 'Видео-приветствие', memberId: 'u2', memberName: 'Тимур Ахметов', people,
    events: [event(1, 'submission', 'u2'), event(2, 'review', 'lead', { reviewStatus: 'revision' })] };
  const { harness, FeedbackPanel } = panel({
    '/api/feedback?scope=personal': { threads: [{ ...waitingThread, needsReply: false }] },
    '/api/feedback/th1/read': { read: true },
    '/api/feedback/th1?scope=personal': { thread: detail },
  }, calls);
  let tree = harness.mount(FeedbackPanel, { viewerId: 'u2', selectedTaskId: 't1', onOpenTask: (taskId) => opened.push(taskId) });
  try {
    tree = await harness.settle();
    tree = await harness.settle();
    const head = nodes(tree, (node) => node.type === 'div' && Array.isArray(node.props.children) && node.props.children.some((child) => child?.props?.['aria-label'] === 'Назад к списку'))[0];
    assert.ok(head, 'the conversation opens for the task');
    assert.match(text(head), /Асель Нурланова/);
    assert.match(text(head), /На доработке/);
    const photo = nodes(head, (node) => typeof node.type === 'function' && node.props?.name === 'Асель Нурланова')[0];
    assert.equal(photo.props.src, 'https://cdn.test/a.webp');
    button(head, 'Исправить работу').props.onClick();
    assert.deepEqual(opened, ['t1']);
    assert.equal(button(head, 'Ответ не нужен'), undefined, 'participants cannot dismiss');
    assert.equal(nodes(tree, (node) => node.type === 'small' && /Прочитано/.test(text(node))).length, 0, 'no read receipts for participants');
  } finally { harness.unmount(); }
});
