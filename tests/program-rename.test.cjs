const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const text = (node) => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);

test('a mentor renames a program from its card; the journal notes the old and new name', async () => {
  const harness = hookHarness();
  const calls = [], notices = [];
  const FormSheet = () => null;
  const program = { id: 'p1', title: 'Программа 1', deadlineHours: 24, isActive: true, publisherId: 'mentor', createdAt: '2026-10-01', updatedAt: '2026-10-01' };
  const { ProgramsPanel } = loadTs('frontend/features/admin/ProgramsPanel.tsx', {
    react: harness.react,
    '@/frontend/shared/FormSheet': { FormSheet },
    '@/frontend/shared/api/admin-client': { updateAdminProgram: async (id, patch) => { calls.push([id, patch]); return { ...program, ...patch }; } },
  });
  let props = { programs: [program], tasks: [], actorId: 'mentor', canManageAll: false, onError: (message) => notices.push(message), onEditTask() {}, onToggleTask() {}, onRemoveTask() {},
    onChange(programs) { props = { ...props, programs }; harness.render(props); } };
  let tree = harness.mount(ProgramsPanel, props);
  try {
    // «Переименовать» lives in the program's ⋯ menu.
    const menu = nodes(tree, (node) => Array.isArray(node.props?.items) && node.props.title === 'Программа 1')[0];
    assert.deepEqual(menu.props.items.map((item) => item.label), ['Переименовать', 'Закрепить сверху', 'Скрыть от участников', 'Перенести на уровень 2', 'Перенести на уровень 3', 'Удалить программу']);
    menu.props.items[0].onSelect();
    tree = await harness.settle();
    let form = nodes(tree, (node) => node.type === FormSheet)[0];
    assert.ok(form, 'the rename form did not open');
    const input = () => nodes(form, (node) => node.type === 'input')[0];
    assert.equal(input().props.value, 'Программа 1', 'the form starts from the current name');
    input().props.onChange({ target: { value: '  Скрипты продаж ' } });
    tree = await harness.settle();
    form = nodes(tree, (node) => node.type === FormSheet)[0];
    form.props.onSubmit();
    tree = await harness.settle();
    assert.deepEqual(calls, [['p1', { title: 'Скрипты продаж' }]]);
    assert.equal(props.programs[0].title, 'Скрипты продаж');
    assert.equal(nodes(tree, (node) => node.type === FormSheet).length, 0, 'the form stays open after saving');
    assert.deepEqual(notices, ['Название программы сохранено.']);
  } finally { harness.unmount(); }

  const { describeJournalEntry } = loadTs('frontend/features/ceo/journal-format.ts');
  const line = describeJournalEntry({ action: 'program.rename', targetLabel: 'Скрипты продаж', details: { name: ['Программа 1', 'Скрипты продаж'] } });
  assert.equal(line.title, 'Переименована программа');
  assert.deepEqual(line.lines, ['Название: Программа 1 → Скрипты продаж']);
  assert.equal(line.category, 'content');
});

test('program steps keep one ⋯ menu; arrows appear only in «Изменить порядок»; hidden programs are folded', async () => {
  const harness = hookHarness();
  const ActionsMenu = () => null;
  const { ProgramsPanel } = loadTs('frontend/features/admin/ProgramsPanel.tsx', {
    react: harness.react,
    './AdminTasksView': { ActionsMenu, pinIcon: null },
    '@/frontend/shared/api/admin-client': {},
  });
  const program = (id, title, extra = {}) => ({ id, title, deadlineHours: 24, isActive: true, publisherId: 'mentor', createdAt: '2026-10-01', updatedAt: '2026-10-01', ...extra });
  const step = (id, position) => ({ id, title: 'Шаг ' + id, programId: 'p1', position, maxPoints: 5, isActive: true, publisherId: 'mentor', publicationType: 'sequential', createdAt: '2026-10-01' });
  let tree = harness.mount(ProgramsPanel, { programs: [program('p1', 'Старт'), program('p2', 'Архив', { isActive: false })], tasks: [step('a', 1), step('b', 2)],
    actorId: 'mentor', canManageAll: false, onChange() {}, onError() {}, onEditTask() {}, onToggleTask() {}, onRemoveTask() {}, onAddStep() {} });
  try {
    const stepMenus = () => nodes(tree, (node) => node.type === ActionsMenu && node.props.title.startsWith('Шаг'));
    assert.deepEqual(stepMenus().map((node) => node.props.items.map((item) => item.label)), [['Изменить', 'Скрыть от участников', 'Удалить шаг'], ['Изменить', 'Скрыть от участников', 'Удалить шаг']]);
    assert.equal(nodes(tree, (node) => node.type === 'button' && /Поднять/.test(node.props['aria-label'] || '')).length, 0, 'no arrows outside the order mode');
    nodes(tree, (node) => node.type === 'button' && text(node.props.children).includes('Изменить порядок'))[0].props.onClick();
    tree = await harness.settle();
    assert.equal(stepMenus().length, 0);
    assert.equal(nodes(tree, (node) => node.type === 'button' && /Поднять/.test(node.props['aria-label'] || '')).length, 2);
    const fold = nodes(tree, (node) => node.type === 'button' && text(node.props.children).startsWith('Скрытые'))[0];
    assert.equal(fold.props['aria-expanded'], false, 'hidden programs start folded');
  } finally { harness.unmount(); }
});
