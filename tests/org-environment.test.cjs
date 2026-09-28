const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');
const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap((item) => nodes(item, predicate)) : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const label = (tree) => Array.isArray(tree) ? tree.map(label).join('') : tree && typeof tree === 'object' ? label(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);

test('game content and server answer keys stay aligned', () => {
  const { ORG_QUIZ, ORG_SORT, ORG_BLITZ } = load('shared/domain/org-environment.ts');
  const { readyProgramByKey } = load('shared/domain/ready-programs.ts');
  const { isReadyProgramKey } = load('shared/domain/types.ts');
  const sql = fs.readFileSync(path.resolve(__dirname, '../supabase/20261014-org-environment.sql'), 'utf8');
  const sort = sql.match(/sort_answers int\[\]:=array\[([\d,]+)\]/);
  const blitz = sql.match(/blitz_answers int\[\]:=array\[([\d,]+)\]/);
  assert.ok(sort && blitz);
  assert.equal(ORG_QUIZ.length, 14);
  assert.deepEqual(sort[1].split(',').map(Number), ORG_SORT.map((row) => row[1]));
  assert.deepEqual(blitz[1].split(',').map(Number), ORG_BLITZ.map((row) => Number(row[1])));
  const game = readyProgramByKey('org-environment');
  assert.equal(game.tasks[0].maxPoints, 15900);
  assert.equal(game.tasks[0].publicationType, 'evergreen');
  assert.equal(isReadyProgramKey(game.key), true);
});

test('game endpoint validates moves and passes only the authenticated user to scoring', async () => {
  const calls = [];
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/org-environment.service': { orgEnvironmentAction: async (...args) => {
      calls.push(args); return { data: { phase: 'intro1', score: 0 } };
    } },
  });
  const id = '3e53338f-a163-441f-8aa4-17f92462d5d7';
  const send = (body) => controller.postReadyProgramAttempt(new Request(`http://localhost/api/ready-programs/${id}/attempt`, { method: 'POST', body: JSON.stringify(body) }), id);
  for (const body of [
    { action: 'org-environment', operation: 'retry' },
    { action: 'org-environment', operation: 'answer', index: -1, answer: 0 },
    { action: 'org-environment', operation: 'answer', index: 0, answer: 4 },
    { action: 'org-environment', operation: 'answer', answer: 0 },
  ]) assert.equal((await send(body)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await send({ action: 'org-environment', operation: 'answer', index: 0, answer: null, userId: 'attacker' })).status, 200);
  assert.deepEqual(calls[0], ['member', id, 'answer', 0, null]);
});

test('wrong quiz answer shows explanation, advances to the next question, and cannot restart', async () => {
  const harness = hookHarness();
  const previousWindow = global.window;
  global.window = { setTimeout, clearTimeout, setInterval, clearInterval };
  const css = { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) };
  const order = Array.from({ length: 14 }, (_, index) => index);
  let state = { phase: 'intro1', index: 0, quizOrder: order, sortOrder: order, blitzOrder: order,
    score: 0, streak: 0, best: 0, correct: 0, answered: 0, rounds: [0, 0, 0], completed: false, awaitNext: false,
    serverNow: new Date().toISOString() };
  const actions = [];
  const api = { orgGameAction: async (_taskId, operation, index, answer) => {
    actions.push(operation);
    if (operation === 'begin') state = { ...state, phase: 'quiz', questionStarted: new Date().toISOString() };
    if (operation === 'answer') {
      assert.equal(index, 0); assert.notEqual(answer, 0);
      state = { ...state, index: 1, answered: 1, awaitNext: true,
        last: { phase: 'quiz', index: 0, choice: answer, correct: false, expected: 0, delta: 0, timedOut: false } };
    }
    if (operation === 'advance') state = { ...state, awaitNext: false, questionStarted: new Date().toISOString(), last: null };
    return { ...state, serverNow: new Date().toISOString() };
  } };
  const { OrgEnvironmentGame } = load('frontend/features/member/OrgEnvironmentGame.tsx', {
    react: { ...harness.react, useMemo: (fn) => fn() },
    '@/frontend/shared/api/org-environment-client': api,
    './OrgEnvironmentGame.module.css': css,
  });
  try {
    let tree = harness.mount(OrgEnvironmentGame, { taskId: 'game' });
    await new Promise((resolve) => setTimeout(resolve, 5)); tree = await harness.settle();
    nodes(tree, (node) => node.type === 'button' && label(node) === 'Бастау')[0].props.onClick();
    tree = await harness.settle();
    const wrong = nodes(tree, (node) => node.type === 'button' && label(node).includes('Бір басшының жеке жоспары'))[0];
    assert.ok(wrong);
    wrong.props.onClick(); tree = await harness.settle();
    assert.equal(state.score, 0); assert.equal(state.index, 1);
    assert.match(label(tree), /Қате\./);
    assert.doesNotMatch(label(tree), /Сұрыптау/);
    nodes(tree, (node) => node.type === 'button' && label(node) === 'Келесі →')[0].props.onClick();
    tree = await harness.settle();
    assert.deepEqual(actions, ['start', 'begin', 'answer', 'advance']);
    assert.match(label(tree), /Ұйымның ішкі ортасы/);
  } finally { harness.unmount(); global.window = previousWindow; }
});
