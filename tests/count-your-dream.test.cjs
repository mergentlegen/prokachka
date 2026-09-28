const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');
const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap(item => nodes(item, predicate)) : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const label = tree => Array.isArray(tree) ? tree.map(label).join('') : tree && typeof tree === 'object' ? label(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);

test('dream calculator is a separately published evergreen ready game worth ten miles', async () => {
  const { readyProgramByKey } = load('shared/domain/ready-programs.ts');
  const { isReadyProgramKey } = load('shared/domain/types.ts');
  const { mapTask, mapProgram } = load('frontend/shared/api/client.ts');
  const game = readyProgramByKey('count-your-dream');
  assert.equal(game.title, 'Посчитай свою мечту');
  assert.equal(game.tasks.length, 1);
  assert.equal(game.tasks[0].maxPoints, 10);
  assert.equal(game.tasks[0].publicationType, 'evergreen');
  assert.equal(isReadyProgramKey(game.key), true);
  assert.equal(mapTask({ interactive_kind: game.key }).interactiveKind, game.key);
  assert.equal(mapProgram({ template_key: game.key }).templateKey, game.key);
  let input;
  const service = load('backend/services/programs.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({
      from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null }; } }),
      rpc: async (_name, args) => { input = args.p_input; return { data: { program: { id: 'game' }, tasks: [] } }; },
    }) },
  });
  await service.publishReadyProgram({ teamId: 'team', key: game.key, publisherId: 'mentor', audienceRootId: 'mentor' });
  assert.equal(input.templateKey, game.key);
  assert.equal(input.audienceRootId, 'mentor');
  assert.equal(input.tasks[0].maxPoints, 10);
});

test('dream attempt endpoint rejects malformed payloads before invoking its private RPC', async () => {
  const calls = [];
  const dream = load('backend/services/count-your-dream.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (name, args) => {
      calls.push({ name, args }); return { data: { step: args.p_step, answers: args.p_answers, completed: false } };
    } }) },
  });
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/count-your-dream.service': dream,
  });
  const id = 'd600fb59-ed65-4ffb-a8b0-0bfeaa3ecba5';
  const send = (body) => controller.postReadyProgramAttempt(new Request(`http://localhost/api/ready-programs/${id}/attempt`, { method: 'POST', body: JSON.stringify(body) }), id);
  for (const body of [
    { action: 'count-dream', operation: 'unknown' },
    { action: 'count-dream', operation: 'save', step: 13 },
    { action: 'count-dream', operation: 'save', step: 1.5 },
    { action: 'count-dream', operation: 'save', step: 1, payload: [] },
  ]) assert.equal((await send(body)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await send({ action: 'count-dream', operation: 'save', step: 1, payload: { currency: '₸' } })).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'app_count_your_dream');
  assert.deepEqual(calls[0].args, { p_user_id: 'member', p_task_id: id, p_action: 'save', p_step: 1, p_answers: { currency: '₸' } });
});

test('dream game resumes its voice stage and awards exactly ten miles only after Finish', async () => {
  const harness = hookHarness();
  const answers = { items: [{ n: 'Дом для семьи', p: 1200000 }], currency: '₸', howlong: '1–3 года', plan: 'Да', confidence: 7,
    save: 30000, caseChoice: 'big', extraN: 'Путешествие', extraP: 400000, why: 'Хочу дом для своей семьи', value: 'Семья', time: '5–10 часов', feel: 'Вдохновение', pledged: true };
  const submission = { id: 'reward', points: 10 };
  let finishes = 0, received = 0;
  const api = { countDreamAction: async (_id, action) => {
    if (action === 'complete') { finishes++; return { step: 13, answers, completed: true, earnedPoints: 10, submission }; }
    return { step: 12, answers, completed: false, earnedPoints: 0 };
  } };
  const { CountYourDreamGame } = load('frontend/features/member/CountYourDreamGame.tsx', {
    react: { ...harness.react, useId: () => 'dream' }, '@/frontend/shared/api/count-your-dream-client': api,
  });
  try {
    let tree = harness.mount(CountYourDreamGame, { taskId: 'task', onCompleted: result => { assert.equal(result.points, 10); received++; } });
    tree = await harness.settle();
    assert.match(label(tree), /1\s600\s000 ₸/);
    assert.match(label(tree), /Завершить тренажёр/);
    assert.doesNotMatch(label(tree), /10 миль начислены/);
    const finish = nodes(tree, node => node.type === 'button' && label(node).includes('Завершить тренажёр'))[0];
    finish.props.onClick(); tree = await harness.settle();
    assert.equal(finishes, 1); assert.equal(received, 1);
    assert.match(label(tree), /10 миль начислены/);
    assert.match(label(tree), /Записать голосовое наставнику/);
    assert.doesNotMatch(label(tree), /Наставник подтвердил/);
  } finally { harness.unmount(); }
});
