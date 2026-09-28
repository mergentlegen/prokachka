const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');
const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap((item) => nodes(item, predicate)) : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const label = (tree) => Array.isArray(tree) ? tree.map(label).join('') : tree && typeof tree === 'object' ? label(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);

test('game content and final server answer keys stay aligned', () => {
  const { ORG_QUIZ, ORG_SORT, ORG_BLITZ } = load('shared/domain/org-environment.ts');
  const { readyProgramByKey } = load('shared/domain/ready-programs.ts');
  const { isReadyProgramKey } = load('shared/domain/types.ts');
  const sql = fs.readFileSync(path.resolve(__dirname, '../supabase/20261015-org-environment-batch.sql'), 'utf8');
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

test('game endpoint permits only start and one complete transcript for the authenticated member', async () => {
  const calls = [];
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/org-environment.service': { orgEnvironmentAction: async (...args) => {
      calls.push(args); return { data: { attemptId: 'attempt', score: 0 } };
    } },
  });
  const id = '3e53338f-a163-441f-8aa4-17f92462d5d7';
  const send = (body) => controller.postReadyProgramAttempt(new Request(`http://localhost/api/ready-programs/${id}/attempt`, { method: 'POST', body: JSON.stringify(body) }), id);
  const move = (id, answer, ms) => ({ id, answer, ms });
  const payload = { quiz: Array.from({ length: 10 }, (_, i) => move(i, 0, 1000)),
    sort: Array.from({ length: 15 }, (_, i) => move(i, i < 5 ? 0 : i < 10 ? 1 : 2, 500)),
    blitz: [{ id: 0, answer: 1, atMs: 1000 }] };
  for (const body of [
    { action: 'org-environment', operation: 'answer', index: 0, answer: 1 },
    { action: 'org-environment', operation: 'finish' },
    { action: 'org-environment', operation: 'finish', payload: { ...payload, quiz: [] } },
    { action: 'org-environment', operation: 'finish', payload: { ...payload, blitz: [{ id: 0, answer: 1, atMs: 50000 }] } },
  ]) assert.equal((await send(body)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await send({ action: 'org-environment', operation: 'start', userId: 'attacker' })).status, 200);
  assert.equal((await send({ action: 'org-environment', operation: 'finish', payload, userId: 'attacker' })).status, 200);
  assert.deepEqual(calls[0], ['member', id, 'start', undefined]);
  assert.deepEqual(calls[1], ['member', id, 'finish', payload]);
});

test('local gameplay scores wrong and timed-out answers without network writes', () => {
  const { ORG_SORT, ORG_BLITZ } = load('shared/domain/org-environment.ts');
  const { createOrgSession, beginOrgRound, answerOrgQuestion, advanceOrgQuestion } = load('shared/domain/org-environment-engine.ts');
  const order = Array.from({ length: 20 }, (_, i) => i);
  let state = beginOrgRound(createOrgSession('attempt', order.slice(0, 14), order.slice(0, 15), order), 1000);
  state = answerOrgQuestion(state, 1, 1500);
  assert.equal(state.score, 0); assert.equal(state.index, 1); assert.equal(state.phase, 'quiz');
  state = advanceOrgQuestion(state, 1600);
  state = answerOrgQuestion(state, null, 21600);
  assert.equal(state.index, 2); assert.equal(state.score, 0);
  for (let i = 2; i < 10; i++) {
    state = advanceOrgQuestion(state, 22000 + i * 1000);
    state = answerOrgQuestion(state, 0, 23000 + i * 1000);
  }
  assert.equal(state.phase, 'intro2'); assert.equal(state.transcript.quiz.length, 10);
  state = beginOrgRound(state, 40000);
  for (let i = 0; i < 15; i++) {
    if (i) state = advanceOrgQuestion(state, 40000 + i * 1000);
    state = answerOrgQuestion(state, i === 0 ? 2 : ORG_SORT[i][1], 40500 + i * 1000);
  }
  assert.equal(state.phase, 'intro3'); assert.equal(state.transcript.sort.length, 15);
  state = beginOrgRound(state, 60000);
  state = answerOrgQuestion(state, Number(!ORG_BLITZ[0][1]), 61000);
  state = advanceOrgQuestion(state, 61250);
  state = answerOrgQuestion(state, Number(ORG_BLITZ[1][1]), 62000);
  assert.equal(state.transcript.blitz.length, 2);
  assert.equal(state.transcript.blitz[0].atMs, 1000);
  assert.equal(state.transcript.blitz[1].atMs, 2000);
  assert.equal(state.answered, 27); assert.equal(state.correct, 23);
  assert.equal(state.score, 3648);
  assert.equal(state.rounds.reduce((total, points) => total + points, 0), state.score);
});

test('a wrong quiz click stays local and shows the next question', async () => {
  const harness = hookHarness();
  const previousWindow = global.window;
  const storage = new Map();
  global.window = { setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } };
  const css = { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) };
  const order = Array.from({ length: 20 }, (_, i) => i);
  const calls = [];
  const api = { orgGameStart: async () => { calls.push('start'); return { attemptId: 'attempt', completed: false, score: 0,
    quizOrder: order.slice(0, 14), sortOrder: order.slice(0, 15), blitzOrder: order }; },
    orgGameSubmit: async () => { calls.push('finish'); throw Error('not due'); } };
  const { ORG_QUIZ } = load('shared/domain/org-environment.ts');
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
    nodes(tree, (node) => node.type === 'button' && label(node).includes(ORG_QUIZ[0].w[0]))[0].props.onClick();
    tree = await harness.settle();
    assert.match(label(tree), /Қате/);
    nodes(tree, (node) => node.type === 'button' && label(node) === 'Келесі →')[0].props.onClick();
    tree = await harness.settle();
    assert.match(label(tree), new RegExp(ORG_QUIZ[1].q.slice(0, 8)));
    assert.deepEqual(calls, ['start']);
  } finally { harness.unmount(); global.window = previousWindow; }
});
