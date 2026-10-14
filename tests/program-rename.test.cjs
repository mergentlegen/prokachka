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
    nodes(tree, (node) => node.type === 'button' && node.props['aria-expanded'] === false)[0].props.onClick();
    tree = await harness.settle();
    nodes(tree, (node) => node.type === 'button' && text(node.props.children).includes('Переименовать'))[0].props.onClick();
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
