const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');
const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap(item => nodes(item, predicate)) : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];

test('company catalog and publication use a separate evergreen task with a two-mile reward and branch scope', async () => {
  const { readyProgramByKey } = load('shared/domain/ready-programs.ts');
  const { COMPANY_CARDS, COMPANY_QUESTIONS, COMPANY_STORY_PARTS } = load('shared/domain/company-voyage.ts');
  const { mapTask, mapProgram } = load('frontend/shared/api/client.ts');
  const game = readyProgramByKey('company-voyage');
  assert.equal(game.title, 'Корабль, на который ты поднялся');
  assert.equal(game.tasks[0].maxPoints, 2);
  assert.equal(game.tasks[0].publicationType, 'evergreen');
  assert.equal(COMPANY_CARDS.length, 9); assert.equal(COMPANY_QUESTIONS.length, 18);
  // The right answers in the game and in the database are the same.
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../supabase/20261029-company-voyage-v2.sql'), 'utf8');
  const key = JSON.parse(sql.match(/when 'company-voyage' then '\{"steps":9,"reward":2,"answers":(\[[0-9,]+\])\}'/)[1]);
  assert.deepEqual(COMPANY_QUESTIONS.map(question => question.answer), key);
  assert.ok(COMPANY_QUESTIONS.every(question => question.card >= 1 && question.card <= COMPANY_CARDS.length));
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

test('company quiz: a wrong answer is answered again, and finishing gives no miles — the mentor gives them for the voice', async () => {
  const harness = hookHarness();
  let state = { step: 9, completed: false, status: 'active', earnedPoints: 0, maxPoints: 2, answeredQuestions: 0, questionIndex: 0, mistakes: 0, firstTry: 0 };
  let finishes = 0, received = 0, tried = false;
  const { COMPANY_QUESTIONS, COMPANY_ANSWER_OPTIONS } = load('shared/domain/company-voyage.ts');
  const answers = COMPANY_QUESTIONS.map(question => question.answer);
  const api = {
    startReadyProgram: async () => state,
    answerReadyProgram: async (_id, answer, expected) => {
      assert.equal(expected, state.questionIndex);
      const correct = answer === answers[expected];
      state = { ...state, wrong: !correct, lastAnswer: answer, mistakes: state.mistakes + Number(!correct), firstTry: state.firstTry + Number(correct && !tried),
        questionIndex: expected + Number(correct), answeredQuestions: expected + Number(correct), ready: correct && expected === answers.length - 1 };
      tried = !correct;
      return state;
    },
    completeReadyProgram: async () => { finishes++; state = { ...state, completed: true, earnedPoints: 0 }; return state; },
  };
  const { CompanyVoyageGame } = load('frontend/features/member/CompanyVoyageGame.tsx', { react: harness.react, '@/frontend/shared/api/ready-program-client': api,
    './CompanyVoyageGame.module.css': { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) },
  });
  harness.mount(CompanyVoyageGame, { taskId: 'company', onCompleted() { received++; } });
  let tree = await harness.settle();
  const text = node => [].concat(node.props.children).join('');
  const press = async predicate => { const button = nodes(tree, node => node.type === 'button' && predicate(node))[0]; assert.ok(button, 'button not found'); assert.equal(Boolean(button.props.disabled), false); button.props.onClick(); tree = await harness.settle(); };
  const select = index => press(node => node.props.children === COMPANY_ANSWER_OPTIONS[index]);
  try {
    // A wrong answer: a hint to the card, the card can be opened, and the same question is answered again.
    await select((answers[0] + 1) % 3);
    assert.match(nodes(tree, node => node.props?.role === 'alert')[0].props.children[1].props.children.join(''), /карточке 1/);
    await press(node => text(node).includes('Открыть карточку 1'));
    assert.equal(nodes(tree, node => node.props?.role === 'dialog').length, 1);
    await press(node => node.props.children === 'Вернуться к вопросу');
    await press(node => node.props.children === 'Ответить ещё раз');
    for (const [index, answer] of answers.entries()) {
      await select(answer);
      await press(node => node.props.children === (index === answers.length - 1 ? 'Посмотреть результат' : 'Следующий вопрос'));
    }
    assert.equal(finishes, 1, 'the game is finished once');
    assert.equal(received, 0, 'no miles from the game itself');
    assert.ok(nodes(tree, node => typeof node.props?.children === 'object' && [].concat(node.props.children).join('') === '17 / 18').length, 'score with the first try');
    assert.ok(JSON.stringify(tree).includes('ошибся(лась) 1 раз'), 'mistakes are shown');
    await press(node => node.props.children === 'Дальше: мой рассказ');
    assert.ok(JSON.stringify(tree).includes('Мой рассказ за 60 секунд'));
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
