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
