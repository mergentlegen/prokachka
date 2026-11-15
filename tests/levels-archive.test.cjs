const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');

// Levels before level 2 opens: the archive of an earlier level can be read whole, a returned work can be sent again,
// players see what waits on level 2, mentors filter by level and choose the level of a ready game.

const serviceMocks = {
  '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => null },
  '@/backend/infrastructure/supabase/read-pages': { readPages: async () => ({ data: [] }) },
  '@/backend/services/network.service': { ancestors: () => [], findTeamNetwork: async () => ({ data: [] }), isAudienceVisible: () => true },
};
const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap((item) => nodes(item, predicate))
  : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const step = (id, position, extra = {}) => ({ id, position, title: 'Шаг ' + id, description: 'Текст ' + id, resource_url: null, max_points: 5, publication_type: 'sequential', program_id: 'p1', ...extra });
const accepted = (taskId, points = 5) => ({ id: 's-' + taskId, userId: 'me', taskId, status: 'accepted', points, comment: '', submittedAt: '2026-10-10T10:00:00Z', reviewVersion: 1 });
const task = { id: 't', title: 'Видео', description: 'Запиши', maxPoints: 10, isActive: true, publicationType: 'evergreen', createdAt: '2026-09-01', updatedAt: '2026-09-01' };

test('the archive sends the text of every program step, also steps never reached', () => {
  const { programModules } = loadTs('backend/services/member-progress.service.ts', serviceMocks);
  const programs = [{ id: 'p1', title: 'Старт' }];
  const tasks = [step('a', 1), step('b', 2), step('c', 3)];
  const progress = new Map([['p1', { status: 'active', current_task_id: 'b' }]]);
  const [current] = programModules(programs, tasks, progress);
  assert.deepEqual(current.steps.map((item) => 'description' in item), [true, false, false], 'on the current level closed steps stay closed');
  const [archive] = programModules(programs, tasks, progress, true);
  assert.deepEqual(archive.steps.map((item) => item.description), ['Текст a', 'Текст b', 'Текст c']);
  const [neverStarted] = programModules(programs, tasks, new Map(), true);
  assert.ok(neverStarted.steps.every((item) => item.description), 'a program never started is readable in the archive');
});

test('the archive feed lists every step of the level so their materials open; nothing starts there', async () => {
  const tables = {
    tasks: [
      { id: 'one', team_id: 'team', is_active: true, publication_type: 'evergreen', level: 1, created_at: '2026-09-01' },
      { id: 'a', team_id: 'team', is_active: true, publication_type: 'sequential', program_id: 'players', position: 1, level: 1, title: 'A', description: 'Текст A', created_at: '2026-09-01' },
      { id: 'b', team_id: 'team', is_active: true, publication_type: 'sequential', program_id: 'players', position: 2, level: 1, title: 'B', description: 'Текст B', created_at: '2026-09-01' },
    ],
    task_programs: [{ id: 'players', team_id: 'team', is_active: true, level: 1, title: 'Игроки', deadline_hours: 24, created_at: '2026-09-01' }],
    member_program_progress: [],
    member_levels: [{ user_id: 'm', level: 2, reached_at: '2026-10-20T10:00:00.000Z' }],
  };
  const inserted = [];
  const client = { from(table) {
    return { table, filters: [], select() { return this; }, eq(key, value) { this.filters.push([key, value]); return this; }, is() { return this; }, order() { return this; },
      upsert(rows) { inserted.push(...rows); return { select: async () => ({ data: rows, error: null }) }; } };
  } };
  const service = loadTs('backend/services/member-progress.service.ts', { ...serviceMocks,
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => client },
    '@/backend/infrastructure/supabase/read-pages': { readPages: async (query) => ({ data: (tables[query.table] || []).filter((row) => query.filters.every(([key, value]) => row[key] === value)), error: null }) },
  });
  const archive = await service.getMemberTaskFeed('m', 'team', '2026-01-01T00:00:00.000Z', 1);
  assert.equal(archive.viewLevel, 1);
  assert.deepEqual(archive.passed.map((row) => row.id).sort(), ['a', 'b'], 'never reached steps open for reading');
  assert.equal(service.feedShowsTask(archive, 'b'), true);
  assert.equal(inserted.length, 0, 'the archive starts no program');
  assert.equal(archive.nextLevel, null, 'the level 2 hint is only for players');
});

test('players see what waits on level 2: names and numbers only', () => {
  const { levelPreview } = loadTs('backend/services/member-progress.service.ts', serviceMocks);
  const { levelPreviewText } = loadTs('shared/domain/levels.ts');
  const now = Date.parse('2026-11-15T10:00:00Z');
  const programs = [
    { id: 'cap', title: 'Капитанский старт', level: 2, is_active: true },
    { id: 'empty', title: 'Без шагов', level: 2, is_active: true },
    { id: 'game', title: 'Игра', level: 2, is_active: true, template_key: 'dream-plan' },
    { id: 'lvl1', title: 'Игроки', level: 1, is_active: true },
  ];
  const tasks = [
    ...[1, 2, 3, 4, 5, 6].map((position) => ({ id: 'c' + position, program_id: 'cap', publication_type: 'sequential', level: 2, position, description: 'секрет' })),
    { id: 'g', program_id: 'game', publication_type: 'evergreen', level: 2, interactive_kind: 'dream-plan' },
    { id: 'open', publication_type: 'evergreen', level: 2 },
    { id: 'gone', publication_type: 'fixed', level: 2, deadline_at: '2026-11-01T00:00:00Z' },
    { id: 'mine', publication_type: 'evergreen', level: 1 },
  ];
  const preview = levelPreview(tasks, programs, () => true, now);
  assert.deepEqual(preview, { level: 2, programs: [{ title: 'Капитанский старт', steps: 6 }], tasks: 2 });
  assert.doesNotMatch(JSON.stringify(preview), /секрет/, 'no content of level 2 leaks');
  assert.equal(levelPreviewText(preview), 'программа «Капитанский старт» · 6 шагов и 2 задания');
  assert.equal(levelPreviewText({ level: 2, programs: [], tasks: 1 }), '1 задание');
  assert.equal(levelPreviewText({ level: 2, programs: [{ title: 'А', steps: 1 }, { title: 'Б', steps: 2 }, { title: 'В', steps: 3 }], tasks: 0 }), 'программа «А» · 1 шаг и ещё 2 программы');
  assert.equal(levelPreview(tasks, programs, (row) => row.id !== 'cap' && row.program_id !== 'cap' && row.id !== 'open' && row.id !== 'game' && row.program_id !== 'game', now), null, 'another branch’s level 2 is not counted');
  assert.equal(levelPreviewText(null), '');
});

test('the score card of a player names what waits on level 2', () => {
  const { ScoreCard } = loadTs('frontend/features/member/ScoreCard.tsx');
  const card = (props) => renderToStaticMarkup(React.createElement(ScoreCard, { metric: 'points', miles: 40, stars: 0, rank: 2, level: 1, onOpenRanking() {}, ...props }));
  assert.match(card({ nextLevel: { level: 2, programs: [{ title: 'Капитанский старт', steps: 6 }], tasks: 0 } }), /Там ждёт программа «Капитанский старт» · 6 шагов/);
  assert.doesNotMatch(card(), /Там ждёт/);
});

test('the level 2 hint reaches the member store only in a clean shape', () => {
  const source = fs.readFileSync('frontend/shared/api/client.ts', 'utf8');
  assert.match(source, /nextLevel: mapLevelPreview\(/);
  const { mapLevelPreview } = loadTs('frontend/shared/api/client.ts');
  assert.deepEqual(mapLevelPreview({ level: 2, programs: [{ title: 'А', steps: 3 }, { title: 'Б', steps: 0 }, null], tasks: '2' }), { level: 2, programs: [{ title: 'А', steps: 3 }], tasks: 2 });
  assert.equal(mapLevelPreview({ level: 2, programs: [], tasks: 0 }), undefined);
  assert.equal(mapLevelPreview(null), undefined);
});

test('archive program steps all open for reading, unreached ones marked «не пройден»', () => {
  const { ProgramModules } = loadTs('frontend/features/member/ProgramModules.tsx');
  const modules = [{ id: 'p1', title: 'Старт', isPinned: false, status: 'active', steps: [
    { id: 'a', number: 1, title: 'Видео', maxPoints: 5, description: 'Запиши' }, { id: 'b', number: 2, title: 'Звонок', maxPoints: 5, description: 'Позвони' }] }];
  const html = renderToStaticMarkup(React.createElement(ProgramModules, { modules, tasks: [], readAll: true, selectedId: 'p1', onSelect() {}, onFeedback() {},
    passedTasks: [{ id: 'a', title: 'Видео' }, { id: 'b', title: 'Звонок' }], latest: new Map([['a', accepted('a')]]), renderTask: (item) => 'КАРТОЧКА ' + item.title }));
  assert.match(html, /не пройден/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*Звонок/, 'an unreached step can be opened');
  assert.match(html, /КАРТОЧКА Звонок/);
});

test('archive card: a returned work can be sent again, nothing else can', () => {
  const { TaskCard } = loadTs('frontend/features/member/TaskCard.tsx');
  const card = (props) => renderToStaticMarkup(React.createElement(TaskCard, { task, onSubmit: async () => undefined, readOnly: true, ...props }));
  const returned = card({ submission: { ...accepted('t'), status: 'revision', points: 0, comment: 'Доработай' } });
  assert.match(returned, /Отправить повторно/);
  assert.doesNotMatch(returned, /Архив · только просмотр/);
  assert.match(card(), /Архив · только просмотр/);
  assert.match(card({ submission: { ...accepted('t'), status: 'pending', points: 0 } }), /Ответ на проверке/);
});

test('archive card: a passed game opens with its material, an unplayed one is not started', () => {
  const { TaskCard } = loadTs('frontend/features/member/TaskCard.tsx');
  const game = { ...task, interactiveKind: 'first-year', title: 'Мой первый год' };
  const passed = renderToStaticMarkup(React.createElement(TaskCard, { task: game, readOnly: true, onSubmit: async () => undefined, submission: { ...accepted('t', 10), interactiveCompleted: true } }));
  assert.match(passed, /Материал игры/);
  const unplayed = renderToStaticMarkup(React.createElement(TaskCard, { task: game, readOnly: true, onSubmit: async () => undefined }));
  assert.doesNotMatch(unplayed, /Начать игру/);
  assert.match(unplayed, /Архив · только просмотр/);
});

test('archive game modal: a passed game runs its result screen, an unplayed one offers only the material', () => {
  const stub = (name) => function Stub() { return React.createElement('div', null, 'ИГРА ' + name); };
  const games = Object.fromEntries(['DreamPlanGame', 'StarterRulesGame', 'HeartSurvey', 'CompanyVoyageGame', 'CaptainCruiseGame', 'CountYourDreamGame', 'DreamRouteGame', 'FirstYearGame', 'SafetyWatchGame']
    .map((name) => [name, { [name]: stub(name) }]));
  const open = (props) => {
    const harness = hookHarness();
    const { TaskCard } = loadTs('frontend/features/member/TaskCard.tsx', { react: { ...React, ...harness.react },
      './DreamPlanGame': games.DreamPlanGame, './StarterRulesGame': games.StarterRulesGame, './HeartSurvey': games.HeartSurvey, './CompanyVoyageGame': games.CompanyVoyageGame,
      './CaptainCruiseGame': games.CaptainCruiseGame, './CountYourDreamGame': games.CountYourDreamGame, './DreamRouteGame': games.DreamRouteGame, './FirstYearGame': games.FirstYearGame, './SafetyWatchGame': games.SafetyWatchGame });
    let tree = harness.mount(TaskCard, { onSubmit: async () => undefined, readOnly: true, ...props });
    nodes(tree, (node) => node.type === 'button' && node.props['aria-haspopup'] === 'dialog')[0].props.onClick();
    tree = harness.render();
    return { harness, tree, html: () => renderToStaticMarkup(harness.render()) };
  };
  const game = { ...task, interactiveKind: 'first-year', title: 'Мой первый год' };
  const passed = open({ task: game, submission: { ...accepted('t', 10), interactiveCompleted: true } });
  assert.match(passed.html(), /ИГРА FirstYearGame/, 'a passed game shows its own result and material');
  const unplayed = open({ task: game });
  const html = unplayed.html();
  assert.doesNotMatch(html, /ИГРА FirstYearGame/, 'an unplayed archive game does not start');
  assert.match(html, /пройти её уже нельзя, но материал можно прочитать/);
  nodes(unplayed.tree, (node) => typeof node.props?.hint === 'string')[0].props.onClick();
  assert.match(unplayed.html(), /Игра прошлого уровня: её можно прочитать, но пройти уже нельзя/);
  const noMaterial = open({ task: { ...game, interactiveKind: 'dream-plan' } });
  assert.match(noMaterial.html(), /Игра прошлого уровня: пройти её уже нельзя\./);
});

test('an unanswered test of an earlier level shows its questions to read, no correct answers, own choices marked', () => {
  const { QuizPreviewList } = loadTs('frontend/features/member/TaskQuiz.tsx');
  const html = renderToStaticMarkup(React.createElement(QuizPreviewList, { quiz: {
    questions: [{ id: 'q1', kind: 'single', prompt: 'Сколько?', options: ['Один', 'Два'] }, { id: 'q2', kind: 'text', prompt: 'Почему?' }],
    answers: { q1: { choice: [1] }, q2: { text: 'Потому что' } },
  } }));
  assert.match(html, /ответить здесь уже нельзя/);
  assert.match(html, /Два<\/span><small[^>]*>ваш выбор/);
  assert.doesNotMatch(html, /Один<\/span><small/);
  assert.match(html, /Ваш ответ<\/small>Потому что/);
  assert.doesNotMatch(html, /<input|<textarea|верн/i, 'nothing to answer, no correct answers');
  const card = fs.readFileSync('frontend/features/member/TaskCard.tsx', 'utf8');
  assert.match(card, /isQuiz && readOnly && !canSubmit && !quizSent && status !== "accepted" && <QuizPreview/);
});

test('the archive passes a returned work to sending and refreshes after game progress', () => {
  const archive = fs.readFileSync('frontend/features/member/LevelArchive.tsx', 'utf8');
  assert.match(archive, /onSubmit=\{\(\) => onSubmit\(task\)\}/);
  assert.match(archive, /только работы, которые наставник вернул на доработку/);
  const app = fs.readFileSync('frontend/features/member/MemberApp.tsx', 'utf8');
  assert.match(app, /onSubmit=\{\(task\) => submitTask\(task\.id, task\)\}/);
});

test('mentors filter tasks and programs by level once there is more than one level', () => {
  const harness = hookHarness();
  const { TasksView, taskLevels } = loadTs('frontend/features/admin/AdminTasksView.tsx', { react: harness.react });
  assert.deepEqual(taskLevels([{ level: 2 }, {}, { level: 2 }, { level: 3 }]), [1, 2, 3]);
  const row = (id, level) => ({ id, title: 'Задание ' + id, maxPoints: 5, isActive: true, publicationType: 'evergreen', createdAt: '2026-09-25', level });
  const props = { actorId: 'mentor', canManageAll: true, onToggle() {}, onEdit() {}, onRemove() {}, store: { programs: [], submissions: [], users: [], tasks: [row('a'), row('b', 2), row('c', 2)] } };
  let tree = harness.mount(TasksView, props);
  const titles = () => [...renderToStaticMarkup(tree).matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((match) => match[1]);
  const chips = () => nodes(tree, (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined);
  assert.deepEqual(chips().map((node) => renderToStaticMarkup(node)).map((html) => html.replace(/<[^>]+>/g, '')), ['Все уровни 3', 'Уровень 1 1', 'Уровень 2 2']);
  assert.deepEqual(titles().sort(), ['Задание a', 'Задание b', 'Задание c']);
  chips()[2].props.onClick(); tree = harness.render();
  assert.deepEqual(titles().sort(), ['Задание b', 'Задание c']);
  tree = harness.render({ ...props, store: { ...props.store, tasks: [row('a')] } });
  assert.equal(chips().length, 0, 'one level: no filter');
  assert.deepEqual(titles(), ['Задание a'], 'a chosen level that is gone falls back to all');
  const panel = fs.readFileSync('frontend/features/admin/ProgramsPanel.tsx', 'utf8');
  assert.match(panel, /useLevelFilter\(customPrograms\)/);
});

test('a ready game is published on the chosen level; adding it again on another level moves it', async () => {
  const calls = [];
  let existing = null;
  const query = { select() { return this; }, eq() { return this; }, is() { return this; }, not() { return this; }, order() { return this; },
    async maybeSingle() { return { data: existing, error: null }; }, then(resolve) { resolve({ data: [{ id: 'task' }], error: null }); } };
  const service = loadTs('backend/services/programs.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ from: () => query,
      rpc: async (name, args) => { calls.push([name, args]);
        if (name === 'app_update_program') return { data: { data: { id: 'ready', level: 1 } }, error: null };
        if (name === 'app_set_program_level') return { data: { data: { id: 'ready', level: args.p_level } }, error: null };
        return { data: { program: { id: 'ready' }, tasks: [{ id: 'task' }] }, error: null }; } }) },
    '@/backend/services/network.service': {}, '@/backend/infrastructure/supabase/read-pages': {},
  });
  await service.publishReadyProgram({ teamId: 'team', key: 'dream-plan', publisherId: 'mentor', level: 2 });
  assert.equal(calls[0][0], 'app_create_program_level');
  assert.equal(calls[0][1].p_level, 2);
  calls.length = 0; existing = { id: 'ready', level: 1 };
  const moved = await service.publishReadyProgram({ teamId: 'team', key: 'dream-plan', publisherId: 'mentor', level: 3 });
  assert.deepEqual(calls.map(([name]) => name), ['app_update_program', 'app_set_program_level']);
  assert.equal(moved.data.program.level, 3);
  calls.length = 0;
  await service.publishReadyProgram({ teamId: 'team', key: 'dream-plan', publisherId: 'mentor' });
  assert.deepEqual(calls.map(([name]) => name), ['app_update_program'], 'without a level the game keeps its level');
});

test('the ready games API checks the level', async () => {
  const published = [];
  const controller = loadTs('backend/controllers/ready-programs.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'mentor', role: 'admin', teamId: '11111111-1111-4111-8111-111111111111' }) },
    '@/backend/services/programs.service': { findReadyProgramPublications: async () => ({ data: [] }), publishReadyProgram: async (input) => { published.push(input); return { data: { program: { id: 'p' }, tasks: [] } }; } },
  });
  const post = (body) => controller.postReadyProgram(new Request('http://local/api/ready-programs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  assert.equal((await post({ key: 'dream-plan', level: 4 })).status, 400);
  assert.equal((await post({ key: 'dream-plan', level: 2 })).status, 201);
  assert.equal(published[0].level, 2);
  await post({ key: 'dream-plan' });
  assert.equal(published[1].level, undefined);
});

test('ready games catalog: the level is chosen before adding and changes a published game at once', async () => {
  const harness = hookHarness(), calls = [];
  const { READY_PROGRAMS } = loadTs('shared/domain/ready-programs.ts');
  let publication = null, props, tree;
  const api = {
    loadReadyPrograms: async () => READY_PROGRAMS.map(({ tasks: _tasks, ...item }) => ({ ...item, published: false })),
    publishReadyProgram: async (key, level) => { calls.push(['publish', key, level]); publication = { id: 'ready', templateKey: key, publisherId: 'mentor', isActive: true, level }; return { program: publication, tasks: [] }; },
    updateAdminProgram: async (id, patch) => { calls.push([id, patch]); publication = { ...publication, ...patch }; return publication; },
  };
  const { ReadyProgramsPanel } = loadTs('frontend/features/admin/ReadyProgramsPanel.tsx', { react: harness.react, '@/frontend/shared/api/admin-client': api });
  const messages = [];
  props = { programs: [], tasks: [], actorId: 'mentor', canManageAll: true, onError: (text) => messages.push(text), onChange(programs, tasks) { props = { ...props, programs, tasks }; harness.render(props); } };
  harness.mount(ReadyProgramsPanel, props);
  tree = await harness.settle();
  const select = () => nodes(tree, (node) => node.type === 'select')[0];
  try {
    select().props.onChange({ target: { value: '2' } }); tree = await harness.settle();
    assert.equal(select().props.value, 2);
    nodes(tree, (node) => node.type === 'button' && node.props['aria-label']?.startsWith('Добавить в задания'))[0].props.onClick();
    tree = await harness.settle();
    assert.equal(calls[0][0], 'publish');
    assert.equal(calls[0][2], 2, 'published on the chosen level');
    assert.match(messages.at(-1), /уровня 2/);
    select().props.onChange({ target: { value: '3' } }); tree = await harness.settle();
    assert.deepEqual(calls[1], ['ready', { level: 3 }]);
    assert.match(messages.at(-1), /теперь для уровня 3/);
  } finally { harness.unmount(); }
});
