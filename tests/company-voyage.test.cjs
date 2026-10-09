const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');
const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap(item => nodes(item, predicate)) : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];

test('company catalog and publication use a separate evergreen task with ten-mile reward and branch scope', async () => {
  const { readyProgramByKey } = load('shared/domain/ready-programs.ts');
  const { COMPANY_CARDS, COMPANY_QUESTIONS, COMPANY_STORY_PARTS } = load('shared/domain/company-voyage.ts');
  const { mapTask, mapProgram } = load('frontend/shared/api/client.ts');
  const game = readyProgramByKey('company-voyage');
  assert.equal(game.title, 'Корабль, на который ты поднялся');
  assert.equal(game.tasks[0].maxPoints, 2);
  assert.equal(game.tasks[0].publicationType, 'evergreen');
  assert.equal(COMPANY_CARDS.length, 8); assert.equal(COMPANY_QUESTIONS.length, 17);
  assert.deepEqual(COMPANY_STORY_PARTS.map(part => part.options.length), [3,5,3]);
  assert.equal(COMPANY_QUESTIONS.filter(question => question.trap).length, 3);
  assert.equal(mapTask({ interactive_kind: 'company-voyage' }).interactiveKind, 'company-voyage');
  assert.equal(mapProgram({ template_key: 'company-voyage' }).templateKey, 'company-voyage');
  let input;
  const service = load('backend/services/programs.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({
      from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null }; } }),
      rpc: async (_name, args) => { input = args.p_input; return { data: { program: { id: 'company' }, tasks: [] } }; },
    }) },
  });
  await service.publishReadyProgram({ teamId: 'team', key: 'company-voyage', publisherId: 'publisher', audienceRootId: 'publisher' });
  assert.equal(input.templateKey, 'company-voyage'); assert.equal(input.audienceRootId, 'publisher');
  assert.equal(input.tasks[0].maxPoints, 2); assert.equal(input.tasks[0].interactiveKind, 'company-voyage');
});

test('attempt API accepts question 17 and validates optional story input before the private RPC', async () => {
  const calls = [];
  const service = load('backend/services/ready-programs.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (name, args) => {
      calls.push({ name, args }); return { data: { completed: true, earnedPoints: 2, storyChoices: [2,4,1] } };
    } }) },
  });
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/ready-programs.service': service,
  });
  const id = 'd600fb59-ed65-4ffb-a8b0-0bfeaa3ecba5';
  const send = value => controller.postReadyProgramAttempt(new Request('http://localhost/api/ready-programs/' + id + '/attempt', { method: 'POST', body: JSON.stringify(value) }), id);
  assert.equal((await send({ action: 'answer', answer: 1, questionIndex: 16 })).status, 200);
  assert.equal(calls[0].args.p_expected_question_index, 16);
  for (const choices of [null, [1,2], [1,null,2], [1,5,2], [1.5,0,0]]) assert.equal((await send({ action: 'save-story', choices })).status, 400);
  assert.equal(calls.length, 1);
  assert.equal((await send({ action: 'save-story', choices: [2,4,1] })).status, 200);
  assert.equal(calls[1].name, 'app_save_company_story');
  assert.deepEqual(calls[1].args, { p_user_id: 'member', p_task_id: id, p_choices: [2,4,1] });
});

test('company quiz retains red failure until explicit retry and finishes with ten miles after seventeen answers', async () => {
  const harness = hookHarness();
  const react = { ...harness.react, useId: () => 'company-quiz' };
  let state = { step: 8, completed: false, status: 'active', earnedPoints: 0, maxPoints: 10, answeredQuestions: 0, questionIndex: 0 };
  let retries = 0, finishes = 0, received = 0;
  const answers = [1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1];
  const api = {
    startReadyProgram: async () => state,
    answerReadyProgram: async (_id, answer, expected) => {
      assert.equal(expected, state.questionIndex);
      const correct = answer === answers[expected];
      state = { ...state, failed: !correct, lastAnswer: answer, questionIndex: expected + Number(correct), answeredQuestions: expected + Number(correct), ready: correct && expected === 16 };
      return state;
    },
    restartReadyProgramQuiz: async () => { retries++; state = { ...state, failed: false, lastAnswer: null, questionIndex: 0, answeredQuestions: 0, ready: false }; return state; },
    completeReadyProgram: async () => { finishes++; state = { ...state, completed: true, earnedPoints: 2, submission: { id: 'result', points: 2 } }; return state; },
  };
  const { CompanyVoyageGame } = load('frontend/features/member/CompanyVoyageGame.tsx', { react, '@/frontend/shared/api/ready-program-client': api,
    './CompanyVoyageGame.module.css': { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) },
  });
  harness.mount(CompanyVoyageGame, { taskId: 'company', onCompleted(result) { assert.equal(result.points, 2); received++; } });
  let tree = await harness.settle();
  const press = async predicate => { const button = nodes(tree, node => node.type === 'button' && predicate(node))[0]; assert.ok(button); assert.equal(Boolean(button.props.disabled), false); button.props.onClick(); tree = await harness.settle(); };
  const select = index => press(node => node.props['aria-pressed'] !== undefined && node.props.children[1].props.children === ['Правда','Миф','Не совсем так'][index]);
  try {
    await select(0);
    assert.equal(retries, 0); assert.equal(finishes, 0);
    assert.match(nodes(tree, node => node.props?.['aria-pressed'] === true)[0].props.className, /incorrect/);
    assert.equal(nodes(tree, node => node.props?.role === 'alert').length, 1);
    await press(node => node.props.children === 'Пройти заново'); assert.equal(retries, 1);
    for (const answer of answers) { await select(answer); if (!state.ready) await press(node => node.props.children === 'Следующий вопрос →'); }
    assert.equal(finishes, 0); assert.equal(state.earnedPoints, 0);
    await press(node => node.props.children === 'Завершить и получить 2 мили');
    assert.equal(finishes, 1); assert.equal(received, 1);
    assert.equal(nodes(tree, node => node.type === 'button' && String(node.props.children).includes('Завершить')).length, 0);
  } finally { harness.unmount(); }
});

test('voice link API uses only the authenticated account and reports missing Telegram binding explicitly', async () => {
  const id = 'd600fb59-ed65-4ffb-a8b0-0bfeaa3ecba5'; let calls = 0;
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/telegram-submission.service': { prepareCompanyVoice: async (userId, taskId) => { calls++; assert.equal(userId, 'member'); assert.equal(taskId, id); return { validationError: 'Привяжите Telegram.', linkRequired: true }; } },
  });
  const response = await controller.postReadyProgramAttempt(new Request('http://localhost/api/ready-programs/' + id + '/attempt', { method: 'POST', body: JSON.stringify({ action: 'voice-link', userId: 'other', telegramId: 'other' }) }), id);
  assert.equal(response.status, 422); assert.equal(calls, 1);
});
