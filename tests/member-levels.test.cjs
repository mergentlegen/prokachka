const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');

const id = '11111111-1111-4111-8111-111111111111';
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const text = (tree) => Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : text(tree.props?.children);

test('levels: names and the congratulation of level 2', () => {
  const levels = loadTs('shared/domain/levels.ts');
  assert.equal(levels.parseLevel('2'), 2);
  assert.equal(levels.parseLevel(4), null);
  assert.equal(levels.levelLabel(2), 'Уровень 2 · Капитан');
  assert.deepEqual(levels.levelBadges(1), [], 'no badge before level 2');
  assert.deepEqual(levels.levelBadges(2).map((badge) => badge.title), ['Капитан']);
  assert.deepEqual(levels.levelBadges(3).map((badge) => badge.title), ['Капитан', 'Уровень 3']);
  assert.deepEqual(levels.levelUpMessage(2), { title: 'Ты на безоплатном членстве', text: 'Теперь ты не только игрок — ты капитан своей команды', action: 'Посмотреть мою команду' });
});

function feedService(tables) {
  const inserted = [];
  const client = { from(table) {
    return { table, filters: [], select() { return this; }, eq(key, value) { this.filters.push([key, value]); return this; }, is() { return this; }, order() { return this; },
      upsert(rows) { inserted.push(...rows); tables[table].push(...rows); return { select: async () => ({ data: rows, error: null }) }; } };
  } };
  const service = loadTs('backend/services/member-progress.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => client },
    '@/backend/infrastructure/supabase/read-pages': { readPages: async (query) => ({ data: tables[query.table].filter((row) => query.filters.every(([key, value]) => row[key] === value)), error: null }) },
    '@/backend/services/network.service': { findTeamNetwork: async () => ({ data: [] }), isAudienceVisible: () => true, ancestors: () => new Set() },
  });
  return { service, inserted };
}

test('the feed shows the tasks of the participant’s level; an earlier level opens as an archive where nothing starts', async () => {
  const tables = {
    tasks: [
      { id: 'one', team_id: 'team', is_active: true, publication_type: 'evergreen', level: 1, created_at: '2026-09-01' },
      { id: 'two', team_id: 'team', is_active: true, publication_type: 'evergreen', level: 2, created_at: '2026-09-01' },
      { id: 'captain-step', team_id: 'team', is_active: true, publication_type: 'sequential', program_id: 'captains', position: 1, level: 2, created_at: '2026-09-01' },
      { id: 'player-step', team_id: 'team', is_active: true, publication_type: 'sequential', program_id: 'players', position: 1, level: 1, created_at: '2026-09-01' },
    ],
    task_programs: [
      { id: 'captains', team_id: 'team', is_active: true, level: 2, deadline_hours: 24, created_at: '2026-09-01' },
      { id: 'players', team_id: 'team', is_active: true, level: 1, deadline_hours: 24, created_at: '2026-09-01' },
    ],
    member_program_progress: [],
    member_levels: [{ user_id: 'm', level: 2, reached_at: '2026-10-20T10:00:00.000Z' }],
  };
  const { service, inserted } = feedService(tables);
  const current = await service.getMemberTaskFeed('m', 'team', '2026-01-01T00:00:00.000Z');
  assert.equal(current.level, 2);
  assert.equal(current.viewLevel, 2);
  assert.deepEqual(current.data.map((task) => task.id).sort(), ['captain-step', 'two']);
  assert.deepEqual(inserted.map((row) => [row.program_id, row.unlocked_at]), [['captains', '2026-10-20T10:00:00.000Z']], 'a level 2 program starts on the day of level 2');
  inserted.length = 0;
  tables.member_program_progress = [];
  const archive = await service.getMemberTaskFeed('m', 'team', '2026-01-01T00:00:00.000Z', 1);
  assert.equal(archive.viewLevel, 1);
  assert.deepEqual(archive.data.map((task) => task.id), ['one']);
  assert.equal(inserted.length, 0, 'nothing new starts in the archive');
  const tooHigh = await service.getMemberTaskFeed('m', 'team', undefined, 3);
  assert.equal(tooHigh.viewLevel, 2, 'a level not reached yet is not shown');
  tables.member_levels = [];
  assert.deepEqual((await service.getMemberTaskFeed('m', 'team')).data.map((task) => task.id).sort(), ['one', 'player-step']);
});

test('the task card of the archive shows materials and the result, without sending', () => {
  const { TaskCard } = loadTs('frontend/features/member/TaskCard.tsx');
  const task = { id: 't', title: 'Видео', description: 'Запиши', maxPoints: 10, isActive: true, publicationType: 'evergreen', createdAt: '2026-09-01', updatedAt: '2026-09-01' };
  const fresh = renderToStaticMarkup(React.createElement(TaskCard, { task, onSubmit: async () => undefined, readOnly: true }));
  assert.match(fresh, /Архив · только просмотр/);
  assert.doesNotMatch(fresh, /Отправить ответ/);
  const done = renderToStaticMarkup(React.createElement(TaskCard, { task, readOnly: true, onSubmit: async () => undefined,
    submission: { id: 's', userId: 'm', taskId: 't', status: 'accepted', points: 10, comment: '', submittedAt: '2026-09-02', reviewVersion: 1 } }));
  assert.match(done, /\+10/);
  const game = renderToStaticMarkup(React.createElement(TaskCard, { task: { ...task, interactiveKind: 'dream-plan' }, readOnly: true, onSubmit: async () => undefined }));
  assert.doesNotMatch(game, /Начать игру/);
});

test('the congratulation screen: free membership, captain, and the team button', () => {
  const { LevelUpScreen } = loadTs('frontend/features/member/LevelUpScreen.tsx');
  const html = renderToStaticMarkup(React.createElement(LevelUpScreen, { level: 2, onTeam() {}, onClose() {} }));
  assert.match(html, /Ты на безоплатном членстве/);
  assert.match(html, /Теперь ты не только игрок — ты капитан своей команды/);
  assert.match(html, />Посмотреть мою команду</);
  assert.match(html, /Уровень 2/);
});

test('the level switch lists the current level first and earlier levels as archive', () => {
  const { LevelSwitch } = loadTs('frontend/features/member/LevelArchive.tsx');
  const html = renderToStaticMarkup(React.createElement(LevelSwitch, { level: 2, viewing: 2, onChange() {} }));
  assert.ok(html.indexOf('Уровень 2') < html.indexOf('Уровень 1'));
  assert.match(html, /Капитан/);
  assert.match(html, /архив/);
});

test('the course card names the level and how to reach the next one', () => {
  const { StarCourseCard } = loadTs('frontend/features/member/StarCourseCard.tsx');
  const first = renderToStaticMarkup(React.createElement(StarCourseCard, { miles: 40, stars: 2, rank: 3, level: 1, onOpenRanking() {} }));
  assert.match(first, /300 — переход на уровень 2/);
  const second = renderToStaticMarkup(React.createElement(StarCourseCard, { miles: 0, stars: 0, rank: 1, level: 2, onOpenRanking() {} }));
  assert.match(second, /Уровень 2 · Капитан/);
  assert.match(second, /0\/100 миль/);
  const last = renderToStaticMarkup(React.createElement(StarCourseCard, { miles: 100, stars: 10, rank: 1, level: 3, onOpenRanking() {} }));
  assert.match(last, /Звёздный курс пройден ✓/);
});

test('«Ответили N из M» counts those on the task’s level and anyone who already answered', () => {
  const { taskParticipantResults } = loadTs('frontend/features/admin/task-results.ts');
  const users = [{ id: 'a', name: 'A', role: 'member' }, { id: 'b', name: 'B', role: 'member', level: 2 }, { id: 'c', name: 'C', role: 'member', level: 2 }];
  const submissions = [{ id: 's', userId: 'c', taskId: 'one', status: 'accepted', points: 5, submittedAt: '2026-09-01' }];
  assert.deepEqual(taskParticipantResults({ id: 'two', level: 2 }, { users, submissions }).map((result) => result.user.id), ['b', 'c']);
  assert.deepEqual(taskParticipantResults({ id: 'one' }, { users, submissions }).map((result) => result.user.id), ['a', 'c']);
});

test('only a team admin moves a participant between levels, and the request is checked first', async () => {
  const calls = [];
  const controller = (user) => loadTs('backend/controllers/network.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/network.service': {
      setMemberLevel: async (_actor, target, level) => { calls.push([target, level]); return { data: level }; },
      createTeamInvitation: async () => ({}), getNetworkForViewer: async () => ({ data: [] }), updateNetworkUser: async () => ({ data: {} }),
    },
    '@/backend/services/telegram-notifications.service': { scheduleTelegramDelivery() {} },
    '@/backend/services/audit-log.service': { auditUser: async () => ({ name: 'Алия' }), recordAudit: async () => undefined },
  });
  const post = (body) => new Request('https://example.test/api/network/users/' + id + '/level', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await controller({ id: 'm', role: 'member', canReview: true }).patchMemberLevel(post({ level: 2 }), id)).status, 403);
  assert.equal((await controller({ id: 'a', role: 'admin', teamId: 'team' }).patchMemberLevel(post({ level: 4 }), id)).status, 400);
  const ok = await controller({ id: 'a', role: 'admin', teamId: 'team' }).patchMemberLevel(post({ level: 2 }), id);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).level, 2);
  assert.deepEqual(calls, [[id, 2]]);
});

test('the admin card moves a participant up or back after a confirmation', async () => {
  const harness = hookHarness();
  const saved = [];
  const { NetworkMemberSettings } = loadTs('frontend/features/admin/NetworkMemberSettings.tsx', { react: { ...React, ...harness.react, useMemo: (make) => make() } });
  const user = { id: 'm', name: 'Алия', role: 'member', level: 2, createdAt: '2026-01-01' };
  let tree = harness.mount(NetworkMemberSettings, { user, users: [user], busy: false, onSave: async (input) => { saved.push(input); return true; } });
  try {
    assert.match(text(tree), /Уровень 2 · Капитан/);
    nodes(tree, (node) => node.type === 'button' && text(node) === 'Перевести на 3')[0].props.onClick();
    tree = await harness.settle();
    assert.match(text(tree), /Перевести на уровень 3\?/);
    nodes(tree, (node) => node.type === 'button' && text(node) === 'Да, сохранить')[0].props.onClick();
    await harness.settle();
    assert.deepEqual(saved, [{ level: 3 }]);
  } finally { harness.unmount(); }
});

test('Telegram: the participant is congratulated, the mentor learns who moved up', () => {
  const { levelUpText } = loadTs('backend/services/telegram-notifications.service.ts');
  const member = levelUpText(2, null, 'https://prokachka.kz/');
  assert.match(member, /ты на уровне 2/);
  assert.match(member, /Ты на безоплатном членстве/);
  const mentor = levelUpText(2, 'Алия Бекова', 'https://prokachka.kz/admin?section=network');
  assert.match(mentor, /Алия Бекова — новый уровень: 2 \(Капитан\)/);
});
