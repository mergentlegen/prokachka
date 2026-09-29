const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');
const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap(item => nodes(item, predicate)) : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const label = tree => Array.isArray(tree) ? tree.map(label).join('') : tree && typeof tree === 'object' ? label(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);

test('dream route is a ready game with a single ten-mile reward', () => {
  const { readyProgramByKey } = load('shared/domain/ready-programs.ts');
  const { isReadyProgramKey } = load('shared/domain/types.ts');
  const game = readyProgramByKey('dream-route');
  assert.equal(game.title, 'Мечта → маршрут');
  assert.equal(game.tasks.length, 1);
  assert.equal(game.tasks[0].maxPoints, 10);
  assert.equal(game.tasks[0].publicationType, 'evergreen');
  assert.equal(isReadyProgramKey(game.key), true);
  const { DREAM_ROUTE_CARDS, DREAM_ROUTE_QUESTIONS } = load('shared/domain/dream-route.ts');
  assert.equal(DREAM_ROUTE_CARDS.length, 7);
  assert.equal(DREAM_ROUTE_QUESTIONS.length, 5);
});

test('dream route endpoint validates payload and calls its private RPC', async () => {
  const calls = [];
  const service = load('backend/services/dream-route.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (name, args) => {
      calls.push({ name, args }); return { data: { step: args.p_step, answers: args.p_answers, completed: false } };
    } }) },
  });
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/dream-route.service': service,
  });
  const id = 'd600fb59-ed65-4ffb-a8b0-0bfeaa3ecba5';
  const send = (body) => controller.postReadyProgramAttempt(new Request(`http://localhost/api/ready-programs/${id}/attempt`, { method: 'POST', body: JSON.stringify(body) }), id);
  for (const body of [
    { action: 'dream-route', operation: 'other' },
    { action: 'dream-route', operation: 'save', step: 12 },
    { action: 'dream-route', operation: 'save', step: 1.5 },
    { action: 'dream-route', operation: 'save', step: 1, payload: [] },
  ]) assert.equal((await send(body)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await send({ action: 'dream-route', operation: 'save', step: 1, payload: { dream: 'Дом' } })).status, 200);
  assert.equal(calls[0].name, 'app_dream_route');
  assert.deepEqual(calls[0].args, { p_user_id: 'member', p_task_id: id, p_action: 'save', p_step: 1, p_answers: { dream: 'Дом' } });
});

test('route resumes the voice stage and awards ten miles only on Finish', async () => {
  const harness = hookHarness();
  const answers = { study: [true, true], studyTime: 'по утрам', dream: 'Дом', sum: 1200000, currency: '₸', hook: '💰 Найду деньги на старт',
    gameAnswers: [1, 0, 0, 1, 0, 1, 0], flipOpen: true, openStations: [0], quizAnswers: [1, 0, 1, 1, 2],
    station: '💵 Первый доход — за 14 дней', names: ['Алия', 'Бек', 'Саша'] };
  const submission = { id: 'reward', points: 10 };
  let finishes = 0, received = 0;
  const api = { dreamRouteAction: async (_id, operation) => operation === 'complete'
    ? (finishes++, { step: 12, answers, completed: true, earnedPoints: 10, submission })
    : { step: 11, answers, completed: false, earnedPoints: 0 } };
  const { DreamRouteGame } = load('frontend/features/member/DreamRouteGame.tsx', {
    react: harness.react, '@/frontend/shared/api/dream-route-client': api,
  });
  try {
    let tree = harness.mount(DreamRouteGame, { taskId: 'task', onCompleted: result => { assert.equal(result.points, 10); received++; } });
    tree = await harness.settle();
    assert.match(label(tree), /Завершить маршрут/);
    assert.doesNotMatch(label(tree), /10 миль начислены/);
    nodes(tree, node => node.type === 'button' && label(node).includes('Завершить маршрут'))[0].props.onClick();
    tree = await harness.settle();
    assert.equal(finishes, 1); assert.equal(received, 1);
    assert.match(label(tree), /10 миль начислены/);
    assert.match(label(tree), /Записать голосовое наставнику/);
    assert.doesNotMatch(label(tree), /Наставник подтвердил/);
  } finally { harness.unmount(); }
});
