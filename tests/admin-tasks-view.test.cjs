const assert = require('node:assert/strict');
const test = require('node:test');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const text = (node) => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const at = (offset) => new Date(now + offset).toISOString();
const task = (id, title, extra = {}) => ({ id, title, description: 'd', maxPoints: 30, isActive: true, publicationType: 'fixed', publisherId: 'lead', createdAt: at(-9 * DAY), updatedAt: at(-9 * DAY), ...extra });
const store = (tasks, submissions = []) => ({
  tasks, submissions, programs: [{ id: 'ready', templateKey: 'dream-plan' }], announcements: [], starAwards: [], programProgress: [],
  users: [{ id: 'lead', name: 'Руководитель', role: 'admin', teamId: 'team' }, { id: 'u1', name: 'Алия', role: 'member', teamId: 'team', parentUserId: 'lead' }, { id: 'u2', name: 'Тимур', role: 'member', teamId: 'team', parentUserId: 'lead' }],
});

test('a task says how long is left, or when it ended', () => {
  const { taskState, deadlineLine } = loadTs('frontend/features/admin/AdminTasksView.tsx');
  assert.equal(taskState(task('a', 'A', { deadlineAt: at(2 * DAY + 3600_000) }), now), 'running');
  assert.equal(taskState(task('a', 'A', { deadlineAt: at(-DAY) }), now), 'expired');
  assert.equal(taskState(task('a', 'A', { isActive: false }), now), 'hidden');
  assert.deepEqual(deadlineLine(task('a', 'A', { deadlineAt: at(2 * DAY + 3600_000) }), now), { text: 'осталось 2 дня', tone: 'calm' });
  assert.match(deadlineLine(task('a', 'A', { deadlineAt: at(-3 * DAY) }), now).text, /^срок истёк \d+ \S+/);
  assert.deepEqual(deadlineLine(task('a', 'A'), now), { text: 'без срока', tone: 'none' });
});

test('running tasks come first; finished and hidden ones are folded; ready games stay in their catalog', () => {
  const { TasksView } = loadTs('frontend/features/admin/AdminTasksView.tsx');
  const React = require('react');
  const tasks = [task('run', 'Видео-приветствие', { deadlineAt: at(DAY * 2) }), task('pin', 'Гайд MSC', { isPinned: true }), task('old', 'Старый тест', { deadlineAt: at(-DAY) }),
    task('off', 'Скрытое задание', { isActive: false }), task('game', 'Мечта с планом', { programId: 'ready', interactiveKind: 'dream-plan', publicationType: 'evergreen' })];
  const html = renderToStaticMarkup(React.createElement(TasksView, { store: store(tasks), actorId: 'lead', canManageAll: true, onToggle() {}, onEdit() {}, onRemove() {}, onPin() {} }));
  assert.match(html, /Сейчас идут <span>2<\/span>/);
  assert.ok(html.indexOf('Гайд MSC') < html.indexOf('Видео-приветствие'), 'the pinned task is on top');
  assert.match(html, /Завершённые и скрытые <span>2<\/span>/);
  assert.doesNotMatch(html, /Старый тест|Скрытое задание/, 'finished tasks are folded');
  assert.doesNotMatch(html, /Мечта с планом/);
  assert.equal((html.match(/>Изменить</g) || []).length, 2, 'one visible button per task');
  assert.doesNotMatch(html, />Удалить<|>Скрыть</, 'the rest is in the ⋯ menu');
  assert.doesNotMatch(html, /Все<b|Просроченные/, 'no filter chips');
});

test('search looks into finished tasks too; the ⋯ menu holds pin, hide and delete', async () => {
  const harness = hookHarness();
  const calls = [];
  const { TasksView } = loadTs('frontend/features/admin/AdminTasksView.tsx', { react: harness.react });
  const tasks = [task('run', 'Видео-приветствие'), task('old', 'Старый тест по продукту', { deadlineAt: at(-DAY) })];
  let tree = harness.mount(TasksView, { store: store(tasks), actorId: 'lead', canManageAll: true, onToggle: (id) => calls.push(['toggle', id]), onEdit() {}, onRemove: (item) => calls.push(['remove', item.id]), onPin: (item) => calls.push(['pin', item.id]) });
  const shownCards = () => nodes(tree, (node) => node.props?.task && typeof node.type === 'function');
  let card;
  try {
    assert.deepEqual(shownCards().map((node) => node.props.task.id), ['run']);
    nodes(tree, (node) => node.type === 'input')[0].props.onChange({ target: { value: 'старый' } });
    tree = await harness.settle();
    assert.deepEqual(shownCards().map((node) => node.props.task.id), ['old'], 'a match in the folded part is shown');
    assert.match(text(tree), /Завершённые и скрытые/);
    card = shownCards()[0];
  } finally { harness.unmount(); }
  const inner = hookHarness();
  const cardTree = inner.mount(card.type, card.props);
  try {
    const menu = nodes(cardTree, (node) => Array.isArray(node.props?.items))[0];
    assert.deepEqual(menu.props.items.map((item) => item.label), ['Закрепить сверху', 'Скрыть от участников', 'Удалить']);
    menu.props.items[1].onSelect();
    menu.props.items[2].onSelect();
    assert.deepEqual(calls, [['toggle', 'old'], ['remove', 'old']]);
  } finally { inner.unmount(); }
});

test('«Проверить» appears only with work waiting and review rights; viewers without rights get no buttons', () => {
  const { TasksView } = loadTs('frontend/features/admin/AdminTasksView.tsx');
  const React = require('react');
  const submissions = [{ id: 's1', userId: 'u1', taskId: 'run', status: 'pending', points: 0, comment: '', submittedAt: at(-3600_000) }];
  const tasks = [task('run', 'Видео-приветствие'), task('mine', 'Чужое задание', { publisherId: 'other' })];
  const base = { store: store(tasks, submissions), actorId: 'mentor', canManageAll: false, onToggle() {}, onEdit() {}, onRemove() {} };
  const withReview = renderToStaticMarkup(React.createElement(TasksView, { ...base, onReview() {} }));
  assert.match(withReview, /1 на проверке/);
  assert.equal((withReview.match(/>Проверить</g) || []).length, 1);
  assert.equal((withReview.match(/>Изменить</g) || []).length, 0, 'a mentor manages only their own tasks');
  const noReview = renderToStaticMarkup(React.createElement(TasksView, base));
  assert.doesNotMatch(noReview, />Проверить</);
});

test('the ready catalog counts only the games this mentor manages', () => {
  const { readyPublications } = loadTs('frontend/features/admin/ReadyProgramsPanel.tsx');
  const programs = [{ id: 'a', templateKey: 'dream-plan', isActive: true }, { id: 'b', templateKey: 'heart-survey', isActive: true, publisherId: 'mentor', audienceRootId: 'mentor' }, { id: 'c', isActive: true }];
  assert.deepEqual(readyPublications(programs, 'lead', true).map((program) => program.id), ['a']);
  assert.deepEqual(readyPublications(programs, 'mentor', false).map((program) => program.id), ['b']);
});
