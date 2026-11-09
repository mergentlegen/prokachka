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

test('the score card shows miles or stars, the place and the miles left to level 2', () => {
  const { ScoreCard } = loadTs('frontend/features/member/ScoreCard.tsx');
  const card = (props) => renderToStaticMarkup(React.createElement(ScoreCard, { metric: 'points', miles: 90, stars: 3, rank: 3, level: 1, onOpenRanking() {}, ...props }));
  const first = card();
  assert.match(first, /Общий результат/);
  assert.match(first, /<strong>90<\/strong>/);
  assert.match(first, /До уровня «Капитан» — 10 миль/);
  assert.match(first, /aria-valuenow="90"/);
  assert.match(first, /3 место в рейтинге/);
  assert.match(card({ metric: 'stars' }), /<strong>3<\/strong>.*★ звезды/);
  assert.doesNotMatch(card({ miles: 100 }), /До уровня/, 'nothing left at 100');
  const second = card({ miles: 0, level: 2 });
  assert.match(second, /Уровень 2 · Капитан/);
  assert.doesNotMatch(second, /До уровня/);
  assert.doesNotMatch(first + second, /XP|Опыт/);
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

test('the rating API returns team ratings by miles and by stars, the viewer’s level and a pending congratulation', async () => {
  const miles = [{ id: 'a', name: 'Анна', points: 100 }, { id: 'me', name: 'Я', points: 40 }];
  const stars = [{ id: 'me', name: 'Я', points: 3 }, { id: 'a', name: 'Анна', points: 0 }];
  const calls = [];
  const api = (user, level) => loadTs('backend/controllers/ranking.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/ranking.service': {
      findRanking: async (scope) => { calls.push(['miles', scope]); return { data: miles }; },
      findStarRanking: async (scope) => { calls.push(['stars', scope]); return { data: stars }; },
      findMemberLevel: async (id) => { calls.push(['level', id]); return level; }, markMemberLevelSeen: async () => ({ data: true }),
    },
  });
  const rating = async (user, level = { level: 1, levelUp: null }) => (await (await api(user, level).listRanking(new Request('https://example.test/api/ranking'))).json());
  const first = await rating({ id: 'me', role: 'member', teamId: 'team' });
  assert.deepEqual(first.ranking.map((entry) => entry.name), ['Анна', 'Я'], 'by miles, the whole team');
  assert.deepEqual(first.starRanking.map((entry) => entry.name), ['Я', 'Анна'], 'by stars');
  assert.equal(first.level, 1);
  assert.equal(first.levelUp, null);
  assert.deepEqual(calls, [['miles', { kind: 'team', teamId: 'team' }], ['stars', { kind: 'team', teamId: 'team' }], ['level', 'me']]);
  const second = await rating({ id: 'me', role: 'member', teamId: 'team' }, { level: 2, levelUp: 2 });
  assert.equal(second.level, 2);
  assert.equal(second.levelUp, 2, 'the congratulation that was not shown yet');
  assert.equal((await rating({ id: 'm', role: 'admin', teamId: 'team' }, { level: 2, levelUp: 2 })).levelUp, null, 'only participants are congratulated');
});

test('level 2 comes at 100 miles: the same number on the site and in the database', () => {
  const fs = require('node:fs');
  assert.equal(loadTs('shared/domain/levels.ts').LEVEL_UP_MILES, 100);
  const sql = fs.readFileSync('supabase/20261113-levels-100-miles.sql', 'utf8');
  assert.match(sql, /app_level_totals\(p_user, 1::smallint\) t\) < 100/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\* 20|300/, 'no XP formula left');
});

test('Telegram: the participant is congratulated, the mentor learns who moved up', () => {
  const { levelUpText } = loadTs('backend/services/telegram-notifications.service.ts');
  const member = levelUpText(2, null, 'https://prokachka.kz/');
  assert.match(member, /Ты на уровне 2!/);
  assert.match(member, /Ты на безоплатном членстве/);
  const mentor = levelUpText(2, 'Алия Бекова', 'https://prokachka.kz/admin?section=network');
  assert.match(mentor, /Алия Бекова — новый уровень: 2 \(Капитан\)/);
  assert.match(mentor, /Теперь у него новые задания/);
  assert.doesNotMatch(member + mentor, /Звёздный курс|XP/);
});

test('levels join users by user_id: member_levels has two links to users (user_id, granted_by)', () => {
  const fs = require('node:fs');
  for (const file of ['backend/services/network.service.ts', 'backend/services/program-history.service.ts', 'backend/services/users.service.ts']) {
    const source = fs.readFileSync(file, 'utf8');
    const selects = source.match(/from\("member_levels"\)\.select\("[^"]*"\)/g) || [];
    assert.ok(selects.length > 0, file);
    for (const select of selects) assert.doesNotMatch(select, /[,(]users!inner/, file + ': an ambiguous embed breaks the request in production');
  }
});
