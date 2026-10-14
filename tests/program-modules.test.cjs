const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const { programModules } = loadTs('backend/services/member-progress.service.ts', {
  '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => null },
  '@/backend/infrastructure/supabase/read-pages': { readPages: async () => ({ data: [] }) },
  '@/backend/services/network.service': { ancestors: () => [], findTeamNetwork: async () => ({ data: [] }), isAudienceVisible: () => true },
});
const progress = loadTs('frontend/features/member/member-progress.ts');
const { ProgramModules } = loadTs('frontend/features/member/ProgramModules.tsx');

const step = (id, position, extra = {}) => ({ id, position, title: 'Шаг ' + id, description: 'Текст ' + id, resource_url: null, max_points: 5, publication_type: 'sequential', program_id: 'p1', ...extra });
const accepted = (taskId, points) => ({ id: 's-' + taskId, userId: 'me', taskId, status: 'accepted', points, comment: '', submittedAt: '2026-10-10T10:00:00Z' });

test('the server sends every step in order; steps not reached yet carry only the title and miles', () => {
  const programs = [{ id: 'p1', title: 'Старт', is_pinned: false }, { id: 'ready', title: 'Игра', template_key: 'dream-plan' }];
  const tasks = [step('c', 3), step('a', 1), step('b', 2), step('other', 1, { program_id: 'p2' }), step('g', 1, { program_id: 'ready' })];
  const [program, ...rest] = programModules(programs, tasks, new Map([['p1', { status: 'active', current_task_id: 'b' }]]));
  assert.equal(rest.length, 0, 'ready games are not modules');
  assert.deepEqual(program.steps.map((item) => [item.id, item.number]), [['a', 1], ['b', 2], ['c', 3]]);
  assert.equal(program.current_task_id, 'b');
  assert.equal(program.steps[0].description, 'Текст a', 'a passed step keeps its text');
  assert.equal(program.steps[1].description, undefined, 'the current step text comes with its task card');
  assert.equal(program.steps[2].description, undefined, 'a closed step has no text');
  assert.equal(program.steps[2].title, 'Шаг c');
  const [done] = programModules(programs.slice(0, 1), tasks, new Map([['p1', { status: 'completed', current_task_id: null, completed_at: '2026-10-11T10:00:00Z' }]]));
  assert.equal(done.status, 'completed');
  assert.equal(done.current_task_id, null);
  assert.ok(done.steps.every((item) => item.description), 'a passed program keeps every text');
});

test('steps are passed, current or closed; passed programs go to the end', () => {
  const program = { id: 'p1', title: 'Старт', isPinned: false, status: 'active', currentTaskId: 'b', steps: ['a', 'b', 'c'].map((id, index) => ({ id, number: index + 1, title: id, maxPoints: 5 })) };
  assert.deepEqual(progress.programStepStates(program, new Map([['a', accepted('a', 5)]])), ['done', 'current', 'locked']);
  assert.deepEqual(progress.programStepStates(program, new Map()), ['skipped', 'current', 'locked'], 'a step left behind without acceptance is not shown as passed');
  const finished = { ...program, id: 'p0', status: 'completed', currentTaskId: undefined };
  assert.deepEqual(progress.programStepStates(finished, new Map(['a', 'b', 'c'].map((id) => [id, accepted(id, 2)]))), ['done', 'done', 'done']);
  const pinned = { ...program, id: 'p2', isPinned: true };
  assert.deepEqual(progress.orderedProgramModules([finished, program, pinned]).map((item) => item.id), ['p2', 'p1', 'p0']);
});

test('programs are blocks with progress; a tap opens passed steps with miles, the current card and closed steps with titles', () => {
  const modules = [
    { id: 'p1', title: 'Старт', isPinned: false, status: 'active', currentTaskId: 'b', steps: [
      { id: 'a', number: 1, title: 'Видео-приветствие', maxPoints: 5, description: 'Запиши видео' },
      { id: 'b', number: 2, title: 'Пригласи гостя', maxPoints: 10 },
      { id: 'c', number: 3, title: 'Разбор встречи', maxPoints: 2 },
    ] },
    { id: 'p2', title: 'Тест', isPinned: false, status: 'completed', steps: [{ id: 'd', number: 1, title: 'Тест', maxPoints: 2, description: 'Ответь' }] },
  ];
  const tasks = [{ id: 'b', title: 'Пригласи гостя' }];
  const latest = new Map([['a', accepted('a', 5)], ['d', accepted('d', 2)]]);
  const render = (selectedId, extra = latest) => renderToStaticMarkup(React.createElement(ProgramModules, {
    modules, tasks, latest: extra, selectedId, onSelect() {}, onFeedback() {}, renderTask: (task) => React.createElement('article', null, 'КАРТОЧКА ' + task.title),
  }));
  const closed = render(null);
  assert.match(closed, /<strong>Старт<\/strong><small>Пройдено 1 из 3 · сейчас шаг 2<\/small><em>Пригласи гостя<\/em>/, 'a closed block shows progress and the next step');
  assert.match(closed, /<strong>Тест<\/strong><small>Пройдена · 2 мили<\/small>/, 'a passed program stays as a block');
  assert.equal((closed.match(/aria-expanded="false"/g) || []).length, 2, 'every block starts closed');
  assert.doesNotMatch(closed, /КАРТОЧКА/);
  const open = render('p1');
  assert.match(open, /Видео-приветствие[\s\S]*\+5 миль/, 'a passed step keeps its miles');
  assert.match(open, /Шаг 2 · сейчас[\s\S]*КАРТОЧКА Пригласи гостя/);
  assert.match(open, /Шаг 3 · закрыт[\s\S]*Разбор встречи/, 'a closed step shows its title');
  assert.doesNotMatch(open, /Запиши видео/, 'a passed step opens its text on tap');
  const waiting = render(null, new Map([...latest, ['b', { ...accepted('b', 0), status: 'pending' }]]));
  assert.match(waiting, /шаг 2 на проверке/);
  const empty = renderToStaticMarkup(React.createElement(ProgramModules, { modules: [], tasks, latest, selectedId: null, onSelect() {}, onFeedback() {}, renderTask: () => null }));
  assert.match(empty, /Пока нет программ/);
});
