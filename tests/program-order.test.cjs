// The team leader's order of programs (database rules: tests/program-order.sql).
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const loadTs = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');

const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap((item) => nodes(item, predicate))
  : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const text = (node) => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);
const program = (id, position, extra = {}) => ({ id, title: 'Программа ' + id, deadlineHours: 24, isActive: true, publisherId: 'leader', createdAt: '2026-10-0' + position, updatedAt: '2026-10-01', position, ...extra });

function panel({ canManageAll = true, save = async () => undefined, programs }) {
  const harness = hookHarness();
  const ActionsMenu = function ActionsMenu() { return null; };
  const saved = [], notices = [];
  const { ProgramsPanel } = loadTs('frontend/features/admin/ProgramsPanel.tsx', {
    react: harness.react,
    './AdminTasksView': { ActionsMenu, useLevelFilter: (items) => ({ shown: items, filter: null }) },
    '@/frontend/shared/api/admin-client': { saveProgramOrder: async (ids) => { saved.push(ids); return save(ids); } },
  });
  let props = { programs, tasks: [], actorId: 'leader', canManageAll, onError: (message) => notices.push(message), onEditTask() {}, onToggleTask() {}, onRemoveTask() {},
    onChange(next) { props = { ...props, programs: next }; harness.render(props); } };
  harness.mount(ProgramsPanel, props);
  // One <section> per program card, keyed by the program id.
  const titles = () => nodes(harness.render(props), (node) => node.type === 'section' && node.key).map((node) => 'Программа ' + node.key);
  const button = (label) => nodes(harness.render(props), (node) => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label))[0];
  return { harness, saved, notices, titles, button, props: () => props };
}

test('the panel shows programs in the leader’s place order, not by date', () => {
  const view = panel({ programs: [program('a', 3), program('b', 1), program('c', 2), program('game', undefined, { templateKey: 'dream-plan' })] });
  assert.deepEqual(view.titles(), ['Программа b', 'Программа c', 'Программа a']);
  view.harness.unmount();
});

test('«↕ Порядок программ» puts arrows on the programs, saves the whole list, and the arrows go away with «Готово»', async () => {
  const hidden = program('h', 4, { isActive: false });
  const view = panel({ programs: [program('a', 1), program('b', 2), program('c', 3), hidden] });
  try {
    assert.equal(view.button('Поднять «Программа b» выше'), undefined, 'arrows only in the order mode');
    view.button('↕ Порядок программ').props.onClick();
    assert.ok(view.button('Готово'));
    assert.equal(view.button('Поднять «Программа a» выше').props.disabled, true, 'the first one cannot go higher');
    assert.equal(view.button('Опустить «Программа c» ниже').props.disabled, true, 'the last active one cannot go lower: hidden ones are a separate list');
    view.button('Поднять «Программа c» выше').props.onClick();
    await view.harness.settle();
    assert.deepEqual(view.saved, [['a', 'c', 'b', 'h']], 'the whole list, hidden ones included');
    assert.deepEqual(view.titles(), ['Программа a', 'Программа c', 'Программа b', 'Программа h'], 'the hidden one stays in its folded list');
    view.button('Готово').props.onClick();
    assert.equal(view.button('Поднять «Программа a» выше'), undefined);
  } finally { view.harness.unmount(); }
});

test('a refused order comes back and the reason is shown; only the team leader sees the button', async () => {
  const view = panel({ programs: [program('a', 1), program('b', 2)], save: async () => { throw new Error('Список программ изменился. Обновите страницу и попробуйте снова.'); } });
  try {
    view.button('↕ Порядок программ').props.onClick();
    view.button('Опустить «Программа a» ниже').props.onClick();
    await view.harness.settle();
    assert.deepEqual(view.titles(), ['Программа a', 'Программа b']);
    assert.deepEqual(view.notices, ['Список программ изменился. Обновите страницу и попробуйте снова.']);
  } finally { view.harness.unmount(); }
  const helper = panel({ canManageAll: false, programs: [program('a', 1), program('b', 2)] });
  assert.equal(helper.button('↕ Порядок программ'), undefined);
  helper.harness.unmount();
});

test('programs have no «Закрепить сверху» any more; ready games keep their pins', async () => {
  const source = fs.readFileSync('frontend/features/admin/ProgramsPanel.tsx', 'utf8');
  assert.doesNotMatch(source, /Закрепить сверху|Закреплена|isPinned/);
  assert.match(fs.readFileSync('frontend/features/admin/ReadyProgramsPanel.tsx', 'utf8'), /isPinned: !item\.publishedPinned/);
  const calls = [];
  const db = {
    from() { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { template_key: null }, error: null }) }; return query; },
    rpc: async (name, args) => { calls.push(name); return { data: { data: { id: 'p', ...args } }, error: null }; },
  };
  const service = loadTs('backend/services/programs.service.ts', { '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db } });
  const pinned = await service.updateProgram('p', { isPinned: true }, { id: 'leader', role: 'admin', teamId: 't' });
  assert.match(pinned.validationError, /Программы не закрепляются/);
  assert.deepEqual(calls, [], 'nothing was saved');
});

test('the order endpoint: only the team leader, a clean list of ids, the database decides the rest', async () => {
  let user = { id: 'leader', role: 'admin', teamId: 'team' };
  const sent = [];
  let answer = { data: true };
  const controller = loadTs('backend/controllers/programs.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/programs.service': { saveProgramOrder: async (actor, ids) => { sent.push([actor, ids]); return answer; } },
  });
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const put = (body) => controller.putProgramOrder(new Request('http://localhost/api/programs/order', { method: 'PUT', body: JSON.stringify(body) }));
  assert.equal((await put({ programIds: ids })).status, 200);
  assert.deepEqual(sent, [['leader', ids]]);
  assert.equal((await put({ programIds: ['x'] })).status, 400);
  assert.equal((await put({ programIds: [] })).status, 400);
  answer = { validationError: 'Список программ изменился. Обновите страницу и попробуйте снова.' };
  const stale = await put({ programIds: ids });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).message, /Список программ изменился/);
  user = { id: 'helper', role: 'member', teamId: 'team', canPublishTasks: true };
  assert.equal((await put({ programIds: ids })).status, 403);
  assert.equal(sent.length, 2, 'a member never reaches the database');
  assert.match(fs.readFileSync('app/api/programs/order/route.ts', 'utf8'), /enforceRequestSecurity\(request, "programs-list-order"/);
});

test('the place travels from the database to the page; new programs and lists are sorted by it', () => {
  const { mapProgram } = loadTs('frontend/shared/api/client.ts');
  assert.equal(mapProgram({ id: 'p', team_id: 't', title: 'П', is_active: true, position: 3 }).position, 3);
  assert.equal('position' in mapProgram({ id: 'g', team_id: 't', title: 'Игра', is_active: true, position: null }), false);
  const { compareProgramOrder } = loadTs('shared/domain/publication-order.ts');
  const list = [{ id: 'new', createdAt: '2026-11-21', position: undefined }, { id: 'b', createdAt: '2026-10-01', position: 2 }, { id: 'a', createdAt: '2026-11-01', position: 1 }];
  assert.deepEqual(list.sort(compareProgramOrder).map((item) => item.id), ['a', 'b', 'new']);
  assert.match(fs.readFileSync('backend/services/programs.service.ts', 'utf8'), /\.order\("position", \{ ascending: true, nullsFirst: false \}\)/);
});
