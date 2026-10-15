const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const at = (offset) => new Date(now + offset).toISOString();
const users = [{ id: 'u1', name: 'Алия Бекова', role: 'member' }, { id: 'u2', name: 'Тимур Ахметов', role: 'member' }, { id: 'u3', name: 'Ольга Смирнова', role: 'member' }, { id: 'lead', name: 'Асель', role: 'admin' }];
const task = (id, title, created, extra = {}) => ({ id, title, description: 'd', maxPoints: 10, isActive: true, publicationType: 'fixed', createdAt: created, updatedAt: created, ...extra });
const sub = (userId, taskId, status, points = 0) => ({ id: userId + taskId, userId, taskId, status, points, comment: '', submittedAt: at(-DAY) });
const store = {
  users, programs: [], programProgress: [], announcements: [], starAwards: [],
  tasks: [task('t1', 'Видео-приветствие', at(-2 * DAY)), task('t2', 'Гайд по круизам', '2026-08-10T10:00:00Z')],
  submissions: [sub('u1', 't1', 'accepted', 10), sub('u2', 't1', 'pending')],
};
const publications = [{ id: 't1', type: 'task', title: 'Видео-приветствие', authorName: 'Асель', teamId: 'team', isActive: true, createdAt: at(-2 * DAY), updatedAt: at(-2 * DAY) },
  { id: 't2', type: 'task', title: 'Гайд по круизам', authorName: 'Асель', teamId: 'team', isActive: true, createdAt: '2026-08-10T10:00:00Z', updatedAt: '2026-08-10T10:00:00Z' }];
const pass = ({ children }) => React.createElement(React.Fragment, null, children);

test('history lists are split by month, newest month first', () => {
  const { byMonth, monthTitle } = loadTs('frontend/features/admin/AdminHistoryView.tsx');
  assert.equal(monthTitle('2026-08-10T10:00:00Z'), 'Август 2026');
  const groups = byMonth([{ d: '2026-10-05T10:00:00Z' }, { d: '2026-10-01T10:00:00Z' }, { d: '2026-08-10T10:00:00Z' }], (item) => item.d);
  assert.deepEqual(groups.map((group) => [group.title, group.items.length]), [['Октябрь 2026', 2], ['Август 2026', 1]]);
});

test('a task in history shows its answers bar and only the counts that are not zero', () => {
  const { HistoryView } = loadTs('frontend/features/admin/AdminHistoryView.tsx', { '@/frontend/shared/ModalSheet': { ModalSheet: pass } });
  const html = renderToStaticMarkup(React.createElement(HistoryView, { store, programs: [], publications, onReview() {} }));
  assert.match(html, /Ответили 2 из 3/);
  assert.match(html, />1 выполнено</);
  assert.match(html, />1 на проверке</);
  assert.doesNotMatch(html, />0 /, 'no zero counts');
  assert.match(html, /Август 2026/);
  assert.ok(html.indexOf('Видео-приветствие') < html.indexOf('Гайд по круизам'), 'newest first');
});

test('«Участники»: search by name, open a person, then one of their tasks filtered to them', async () => {
  const harness = hookHarness();
  const ModalSheet = ({ children }) => children;
  const { HistoryView } = loadTs('frontend/features/admin/AdminHistoryView.tsx', { react: harness.react, '@/frontend/shared/ModalSheet': { ModalSheet } });
  let tree = harness.mount(HistoryView, { store, programs: [], publications, onReview() {} });
  try {
    nodes(tree, (node) => node.props?.role === 'tab' && node.props.children === 'Участники')[0].props.onClick();
    tree = await harness.settle();
    nodes(tree, (node) => node.type === 'input')[0].props.onChange({ target: { value: 'тим' } });
    tree = await harness.settle();
    const people = nodes(tree, (node) => node.type === 'button' && nodes(node.props.children, (child) => child.type === 'strong').some((strong) => typeof strong.props.children === 'string'));
    const names = people.map((button) => nodes(button.props.children, (child) => child.type === 'strong')[0].props.children);
    assert.deepEqual(names, ['Тимур Ахметов'], 'mentors and other names are not listed');
    people[0].props.onClick();
    tree = await harness.settle();
    const sheet = nodes(tree, (node) => typeof node.type === 'function' && node.props?.person)[0];
    assert.equal(sheet.props.person.name, 'Тимур Ахметов');
    sheet.props.onOpenTask(store.tasks[0]);
    tree = await harness.settle();
    const results = nodes(tree, (node) => typeof node.type === 'function' && node.props?.task && 'initialQuery' in node.props)[0];
    assert.equal(results.props.initialQuery, 'Тимур Ахметов', 'the task window opens filtered to the person');
  } finally { harness.unmount(); }
});

test('the task results window finds a participant by name', () => {
  const { TaskResultsSheet } = loadTs('frontend/features/admin/TaskResultsSheet.tsx', { '@/frontend/shared/ModalSheet': { ModalSheet: pass } });
  const many = { users: Array.from({ length: 8 }, (_, index) => ({ id: 'm' + index, name: index === 3 ? 'Алия Бекова' : 'Участник ' + index, role: 'member' })), submissions: [] };
  const html = renderToStaticMarkup(React.createElement(TaskResultsSheet, { task: store.tasks[0], store: many, initialQuery: 'алия', onReview() {}, onClose() {} }));
  assert.match(html, /Найти участника по имени/);
  assert.match(html, /Алия Бекова/);
  assert.doesNotMatch(html, /Участник 1/);
});

test('mentor announcements: newest first under the pinned one, author and time, ⋯ menu, hidden ones folded', () => {
  const { AnnouncementsPanel } = loadTs('frontend/features/admin/AnnouncementsPanel.tsx', { './AdminTasksView': { ActionsMenu: () => null, pinIcon: null } });
  const ann = (id, title, created, extra = {}) => ({ id, teamId: 'team', authorId: 'lead', title, content: 'Текст ' + title, photos: [], isActive: true, createdAt: created, updatedAt: created, ...extra });
  const announcements = [ann('a', 'Старое', at(-9 * DAY)), ann('b', 'Новое', at(-3600_000)), ann('c', 'Закреплённое', at(-20 * DAY), { isPinned: true, pinnedAt: at(-DAY) }), ann('d', 'Скрытое', at(-2 * DAY), { isActive: false })];
  const html = renderToStaticMarkup(React.createElement(AnnouncementsPanel, { announcements, users, actorId: 'u2', canManageAll: true, onChange() {}, onError() {} }));
  const order = ['Закреплённое', 'Новое', 'Старое'].map((title) => html.indexOf('>' + title + '<'));
  assert.ok(order[0] < order[1] && order[1] < order[2], 'pinned, then newest first');
  assert.match(html, /Асель · сегодня в \d\d:\d\d/);
  assert.equal((html.match(/>Изменить</g) || []).length, 4, 'one visible button per announcement');
  assert.doesNotMatch(html, />Удалить</);
  assert.match(html, /Скрытые <span>1<\/span>/);
});

test('a program window shows its steps, who is where on the step, and finds a participant by name', () => {
  const { ProgramHistorySheet } = loadTs('frontend/features/admin/AdminHistoryView.tsx', { '@/frontend/shared/ModalSheet': { ModalSheet: pass } });
  const member = (userId, name, status) => ({ userId, name, status, dueAt: at(DAY) });
  const program = { id: 'p', teamId: 'team', title: 'Старт', deadlineHours: 72, isActive: true, createdAt: at(-9 * DAY), members: [],
    steps: [{ id: 's1', title: 'Видео', position: 1, maxPoints: 5, deadlineHours: 72, members: [member('u1', 'Алия Бекова', 'on_time'), member('u2', 'Тимур Ахметов', 'missed'), member('u3', 'Ольга Смирнова', 'active')] },
      { id: 's2', title: 'Звонок', position: 2, maxPoints: 5, deadlineHours: 72, members: [] }] };
  const all = renderToStaticMarkup(React.createElement(ProgramHistorySheet, { program, onClose() {} }));
  assert.match(all, /<b>Шаг 1<\/b><span>Видео<\/span>/);
  assert.match(all, /<b>Шаг 2<\/b><span>Звонок<\/span>/);
  assert.match(all, />1 успели</);
  assert.match(all, />1 просрочили</);
  assert.match(all, /Тимур Ахметов[\s\S]*Просрочил/);
  const found = renderToStaticMarkup(React.createElement(ProgramHistorySheet, { program, initialQuery: 'ольга', onClose() {} }));
  assert.match(found, /Ольга Смирнова/);
  assert.doesNotMatch(found, /Тимур Ахметов|Алия Бекова/);
});
