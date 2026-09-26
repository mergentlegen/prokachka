const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(item => nodes(item, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}

test('rules publication and API mapping retain an independent template, no deadline and 5-mile reward', async () => {
  const { readyProgramByKey } = load('shared/domain/ready-programs.ts');
  const { mapProgram, mapTask } = load('frontend/shared/api/client.ts');
  const rules = readyProgramByKey('starter-rules');
  assert.equal(rules.title, 'Правила игры');
  assert.equal(rules.tasks[0].publicationType, 'evergreen');
  assert.equal(rules.tasks[0].maxPoints, 5);
  assert.equal(mapTask({ interactive_kind: 'starter-rules' }).interactiveKind, 'starter-rules');
  assert.equal(mapProgram({ template_key: 'starter-rules' }).templateKey, 'starter-rules');
  assert.equal(mapTask({ interactive_kind: 'unknown' }).interactiveKind, undefined);
  let payload;
  const service = load('backend/services/programs.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({
      from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null }; } }),
      rpc: async (_name, args) => { payload = args.p_input; return { data: { program: { id: 'rules' }, tasks: [] } }; },
    }) },
  });
  await service.publishReadyProgram({ teamId: 'team', key: 'starter-rules', publisherId: 'publisher', audienceRootId: 'publisher' });
  assert.equal(payload.templateKey, 'starter-rules');
  assert.equal(payload.audienceRootId, 'publisher');
  assert.equal(payload.tasks[0].interactiveKind, 'starter-rules');
});

test('server validation reaches HTTP 409 and answer requests carry their expected question', async () => {
  const calls = [];
  const service = load('backend/services/ready-programs.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (name, args) => {
      calls.push({ name, args }); return { data: { validationError: 'Сначала пройдите все шаги программы.' } };
    } }) },
  });
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/ready-programs.service': service,
  });
  const id = 'd600fb59-ed65-4ffb-a8b0-0bfeaa3ecba5';
  const request = value => new Request('http://localhost/api/ready-programs/' + id + '/attempt', { method: 'POST', body: JSON.stringify(value) });
  assert.equal((await controller.postReadyProgramAttempt(request({ action: 'answer', answer: 1, questionIndex: -1 }), id)).status, 400);
  assert.equal(calls.length, 0);
  const response = await controller.postReadyProgramAttempt(request({ action: 'answer', answer: 1, questionIndex: 0 }), id);
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /Сначала пройдите/);
  assert.equal(calls[0].args.p_expected_question_index, 0);
});

test('quiz keeps a wrong selection visible, restarts only on demand, and awards only after Finish', async () => {
  const harness = hookHarness();
  const react = { ...harness.react, useId: () => 'rules-quiz', useMemo: fn => fn() };
  const { STARTER_RULES_QUESTIONS } = load('frontend/features/member/StarterRulesGame.tsx');
  let state = { attemptId: 'attempt', step: 1, status: 'active', attemptNumber: 1, earnedPoints: 0, maxPoints: 5, questionIndex: 0, completed: false };
  let retries = 0, finishes = 0, received = 0;
  const api = {
    answerReadyProgram: async (_id, answer, expected) => {
      assert.equal(expected, state.questionIndex);
      const correct = [1,1,0,1,2][state.questionIndex] === answer;
      state = { ...state, failed: !correct, lastAnswer: answer, earnedPoints: state.earnedPoints + Number(correct), questionIndex: state.questionIndex + Number(correct), ready: correct && state.questionIndex === 4 };
      return state;
    },
    restartReadyProgramQuiz: async () => { retries += 1; state = { ...state, failed: false, lastAnswer: null, questionIndex: 0, earnedPoints: 0, attemptNumber: 2 }; return state; },
    completeReadyProgram: async () => { finishes += 1; state = { ...state, status: 'completed', completed: true, submission: { id: 'result', points: 5 } }; return state; },
  };
  const { ReadyProgramQuiz } = load('frontend/features/member/ReadyProgramQuiz.tsx', { react, '@/frontend/shared/api/ready-program-client': api,
    './DreamPlanGame.module.css': { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) },
  });
  let tree = harness.mount(ReadyProgramQuiz, { taskId: 'rules', initialAttempt: state, questions: STARTER_RULES_QUESTIONS, onBack() {}, onCompleted(result) { assert.equal(result.points, 5); received += 1; } });
  const press = async predicate => {
    const button = nodes(tree, node => node.type === 'button' && predicate(node))[0];
    assert.ok(button); assert.equal(button.props.disabled || false, false);
    button.props.onClick(); tree = await harness.settle();
  };
  const select = index => press(node => node.props['aria-pressed'] !== undefined && node.props.children[1].props.children === STARTER_RULES_QUESTIONS[state.questionIndex].options[index]);
  try {
    await select(0);
    assert.equal(retries, 0); assert.equal(finishes, 0);
    assert.equal(nodes(tree, node => node.type === 'button' && node.props['aria-pressed'] === true)[0].props.className.includes('incorrect'), true);
    assert.equal(nodes(tree, node => node.type === 'button' && node.props['aria-pressed'] !== undefined).every(node => node.props.disabled), true);
    assert.equal(nodes(tree, node => node.props?.role === 'alert').length, 1);
    await press(node => node.props.children === 'Пройти заново');
    assert.equal(retries, 1); assert.equal(state.earnedPoints, 0);
    for (const index of [1,1,0,1,2]) {
      await select(index);
      if (!state.ready) await press(node => node.props.children === 'Следующий вопрос →');
    }
    assert.equal(finishes, 0); assert.equal(received, 0);
    await press(node => node.props.children === 'Завершить и получить 5 миль');
    assert.equal(finishes, 1); assert.equal(received, 1);
    assert.equal(nodes(tree, node => node.type === 'button' && String(node.props.children).includes('Завершить')).length, 0);
  } finally { harness.unmount(); }
});
