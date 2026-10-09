const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

const game = loadTs('shared/domain/first-year.ts');
const task = '22222222-2222-4222-8222-222222222222';
const program = '33333333-3333-4333-8333-333333333333';

test('the game counts club points exactly like the original HTML', () => {
  const perfect = game.replayFirstYear([0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0]);
  assert.equal(perfect.points, 2550, '350 + 11 months × 200');
  assert.equal(perfect.goalMonth, 7, 'the goal of 1 500 is reached in month 7');
  assert.deepEqual([perfect.correct, perfect.quizzes, perfect.late], [4, 4, 0]);
  assert.equal(perfect.autopay, true);
  const late = game.replayFirstYear([1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0]);
  assert.equal(late.late, 2, 'months 2 and 6 were paid late');
  assert.equal(late.points, 2350, 'a late payment brings 100 instead of 200');
  assert.equal(late.marks[2], 'late');
  assert.deepEqual([late.correct, late.quizzes], [0, 4]);
  assert.equal(game.FIRST_YEAR_MONTHS.length, 12);
  assert.equal(game.FIRST_YEAR_REWARD, 2, 'two miles for the game');
});

test('leaving the club is never part of a finished year', () => {
  assert.deepEqual(game.firstYearAllowed(3), [1]);
  assert.deepEqual(game.firstYearAllowed(4), [1]);
  assert.deepEqual(game.firstYearAllowed(6), [0, 1]);
  assert.deepEqual(game.firstYearAllowed(8), [0, 1, 2]);
  const state = game.replayFirstYear([0, 0]);
  const { delta, choice } = game.applyFirstYear(state, 3, 0);
  assert.equal(choice.effect, 'fail');
  assert.equal(delta, 0);
});

test('game requests are checked before they reach the database', async () => {
  const calls = [];
  const controller = loadTs('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'm', role: 'member', teamId: 'team' }) },
    '@/backend/services/first-year.service': { firstYearAction: async (...args) => { calls.push(args); return { data: { step: 1, completed: false } }; } },
  });
  const post = (body) => controller.postReadyProgramAttempt(new Request('http://localhost/api/ready-programs/' + task + '/attempt', { method: 'POST', body: JSON.stringify(body) }), task);
  assert.equal((await post({ action: 'first-year', operation: 'cheat' })).status, 400);
  assert.equal((await post({ action: 'first-year', operation: 'save', step: 13, payload: { choices: [] } })).status, 400);
  assert.equal((await post({ action: 'first-year', operation: 'save', step: 1, payload: { choices: [0] } })).status, 200);
  assert.deepEqual(calls[0].slice(1, 4), [task, 'save', 1]);
});

test('program endpoints: only valid step lists reach the database', async () => {
  const rpc = [];
  const controller = loadTs('backend/controllers/program-steps.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'a', role: 'admin', teamId: 'team', name: 'Асель' }) },
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (name, args) => { rpc.push([name, args]); return { data: name === 'app_program_reorder' ? { data: true } : { forbidden: true }, error: null }; } }) },
    '@/backend/services/audit-log.service': { auditRecord: async () => null, recordAudit: async () => undefined },
  });
  const req = (method, body) => new Request('http://localhost/api/programs/' + program, { method, body: JSON.stringify(body) });
  assert.equal((await controller.reorderProgramSteps(req('PUT', { taskIds: ['not-a-uuid'] }), program)).status, 400);
  assert.equal((await controller.reorderProgramSteps(req('PUT', { taskIds: [task] }), program)).status, 200);
  assert.deepEqual(rpc[0], ['app_program_reorder', { p_actor: 'a', p_program: program, p_task_ids: [task] }]);
  assert.equal((await controller.addProgramGame(req('POST', { kind: 'first-year' }), program)).status, 403, 'the database refusal is passed on');
});

test('a game step can be hidden or removed, but not edited like a normal task', async () => {
  const row = { id: task, team_id: 'team', publisher_id: 'a', program_id: program, interactive_kind: 'first-year', publication_type: 'sequential' };
  const supabase = { from() {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row }), update: () => query, single: async () => ({ data: { ...row, is_active: false } }), delete: () => query, then: (resolve) => resolve({ data: [], error: null }) };
    return query;
  } };
  const service = loadTs('backend/services/tasks.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => supabase },
    '@/backend/services/task-attachments.service': { removeAttachmentPaths: async () => ({ warning: false }) },
  });
  const admin = { id: 'a', role: 'admin', teamId: 'team' };
  assert.match((await service.patchTask(task, { title: 'Новое имя' }, admin)).validationError, /только скрыть/);
  assert.equal((await service.patchTask(task, { isActive: false }, admin)).data.is_active, false);
  assert.equal((await service.deleteTask(task, admin)).data, true);
  row.publication_type = 'evergreen';
  assert.match((await service.deleteTask(task, admin)).validationError, /каталоге/, 'catalog games still go through the catalog');
});

test('a new step goes through checks before the database adds it to the program', async () => {
  const rpc = [];
  const controller = loadTs('backend/controllers/program-steps.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'a', role: 'admin', teamId: 'team', name: 'Асель' }) },
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (name, args) => { rpc.push([name, args]); return { data: { data: { id: task }, reopened: 3 }, error: null }; } }) },
    '@/backend/services/audit-log.service': { auditRecord: async () => ({ teamId: 'team' }), recordAudit: async () => undefined },
  });
  const post = (body) => controller.addProgramStep(new Request('http://localhost/api/programs/' + program + '/steps', { method: 'POST', body: JSON.stringify(body) }), program);
  assert.equal((await post({ title: 'Ш', description: 'Описание', maxPoints: 5 })).status, 400, 'too short title');
  assert.equal((await post({ title: 'Шаг', description: 'Описание', maxPoints: -1 })).status, 400, 'negative miles');
  assert.equal((await post({ title: 'Шаг', description: 'Описание', maxPoints: 5, resourceUrl: 'javascript:alert(1)' })).status, 400, 'unsafe link');
  assert.equal(rpc.length, 0, 'nothing invalid reached the database');
  const response = await post({ title: ' Новый шаг ', description: ' Что сделать ', maxPoints: 5, resourceUrl: '' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).reopened, 3, 'the mentor learns how many finished participants got the step');
  assert.deepEqual(rpc[0], ['app_program_add_step', { p_actor: 'a', p_program: program, p_title: 'Новый шаг', p_description: 'Что сделать', p_resource_url: null, p_max_points: 5 }]);
});

test('a step added after a participant finished is shown as open, not missed', async () => {
  const dbKey = '@/backend/infrastructure/supabase/admin-client';
  const now = Date.now(), iso = (offset) => new Date(now + offset).toISOString();
  const members = [{ id: 'm', name: 'Member', role: 'member', team_id: 'team', team_joined_at: '2026-01-01T00:00:00Z' }];
  const tables = {
    users: members,
    task_programs: [{ id: 'program', team_id: 'team', title: 'Program', created_at: '2026-01-01T00:00:00Z', deadline_hours: 24 }],
    tasks: [{ id: 'one', program_id: 'program', position: 1, title: 'One', max_points: 5 }, { id: 'two', program_id: 'program', position: 2, title: 'Two', max_points: 5 }],
    member_program_progress: [{ user_id: 'm', program_id: 'program', current_task_id: 'two', status: 'active', unlocked_at: iso(-3_600_000), due_at: iso(23 * 3_600_000) }],
    submissions: [{ id: 's', user_id: 'm', task_id: 'one', status: 'accepted', points: 5, submitted_at: '2026-02-01T00:00:00Z', reviewed_at: '2026-02-01T01:00:00Z' }],
  };
  const db = { from(table) {
    let nullColumn;
    const query = new Proxy({}, { get: (_, key) => key === 'range'
      ? async () => ({ data: nullColumn ? tables[table].filter((row) => row[nullColumn] == null) : tables[table], error: null })
      : key === 'is' ? (column, value) => { if (value === null) nullColumn = column; return query; } : () => query });
    return query;
  } };
  const network = loadTs('backend/services/network.service.ts', { [dbKey]: { getSupabaseAdmin: () => db } });
  const history = loadTs('backend/services/program-history.service.ts', {
    [dbKey]: { getSupabaseAdmin: () => db },
    '@/backend/services/network.service': { ...network, findTeamNetwork: async () => ({ data: members }) },
  });
  const result = await history.findProgramHistory('team', { id: 'root', role: 'admin' });
  const added = result.data[0].steps[1].members[0];
  assert.equal(added.status, 'active', 'the new step is open, its time has not run out');
  assert.equal(added.dueAt, tables.member_program_progress[0].due_at, 'the deadline counts from the day the step opened');
  assert.equal(result.data[0].members[0].status, 'active');
});

test('«Вахта безопасности»: the answers in the game and in the database are the same', () => {
  const watch = loadTs('shared/domain/safety-watch.ts');
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../supabase/20261027-safety-watch.sql'), 'utf8');
  for (let deck = 1; deck <= 4; deck++) {
    const key = sql.match(new RegExp(`when ${deck} then '(\[[0-9,]+\])'::jsonb`))[1];
    assert.deepEqual(watch.safetyWatchKey(deck), JSON.parse(key), `deck ${deck}`);
  }
  assert.equal(watch.SAFETY_WATCH_TOTAL, 25);
  assert.equal(watch.SAFETY_WATCH_REWARD, 2);
  for (const deck of watch.SAFETY_WATCH_DECKS) for (const question of deck.qs) {
    const options = deck.type === 'two' ? deck.labels : question.opts;
    assert.ok(question.a >= 0 && question.a < options.length, question.q);
    assert.ok(watch.SAFETY_WATCH_SOURCES[question.src], question.q);
  }
  const games = loadTs('shared/domain/program-games.ts');
  assert.deepEqual(games.PROGRAM_GAMES.map((game) => game.kind), ['first-year', 'safety-watch']);
});

test('«Вахта безопасности» requests are checked before they reach the database', async () => {
  const calls = [];
  const controller = loadTs('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'm', role: 'member', teamId: 'team' }) },
    '@/backend/services/safety-watch.service': { safetyWatchAction: async (...args) => { calls.push(args); return { data: { step: 1, completed: false } }; } },
  });
  const post = (body) => controller.postReadyProgramAttempt(new Request('http://localhost/api/ready-programs/' + task + '/attempt', { method: 'POST', body: JSON.stringify(body) }), task);
  assert.equal((await post({ action: 'safety-watch', operation: 'cheat' })).status, 400);
  assert.equal((await post({ action: 'safety-watch', operation: 'save', step: 5, payload: { answers: [0] } })).status, 400, 'no fifth deck');
  assert.equal((await post({ action: 'safety-watch', operation: 'save', step: 1, payload: { answers: [0, 9] } })).status, 400, 'no such option');
  assert.equal((await post({ action: 'safety-watch', operation: 'save', step: 1, payload: { answers: [0, 1, 0, 1, 1, 1, 1, 0] } })).status, 400, 'too many answers');
  assert.equal(calls.length, 0);
  assert.equal((await post({ action: 'safety-watch', operation: 'save', step: 1, payload: { answers: [0, 1, 0, 1, 1, 1, 1], fixes: 1, seen: 8 } })).status, 200);
  assert.deepEqual(calls[0].slice(1, 4), [task, 'save', 1]);
});

test('only games from the catalog can be added to a program', async () => {
  const rpc = [];
  const controller = loadTs('backend/controllers/program-steps.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'a', role: 'admin', teamId: 'team', name: 'Асель' }) },
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (name, args) => { rpc.push([name, args]); return { data: { data: { id: task }, reopened: 0 }, error: null }; } }) },
    '@/backend/services/audit-log.service': { auditRecord: async () => ({ teamId: 'team' }), recordAudit: async (_user, entry) => { rpc.push(['audit', entry.targetLabel]); } },
  });
  const req = (body) => new Request('http://localhost/api/programs/' + program + '/games', { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await controller.addProgramGame(req({ kind: 'unknown' }), program)).status, 400);
  assert.equal(rpc.length, 0);
  assert.equal((await controller.addProgramGame(req({ kind: 'safety-watch' }), program)).status, 201);
  assert.deepEqual(rpc, [['app_program_add_game', { p_actor: 'a', p_program: program, p_kind: 'safety-watch' }], ['audit', 'Игра «Вахта безопасности»']]);
});
