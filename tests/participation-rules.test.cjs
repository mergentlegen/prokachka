const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const load = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap((item) => nodes(item, predicate)) : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const label = (tree) => Array.isArray(tree) ? tree.map(label).join('') : tree && typeof tree === 'object' ? label(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
const taskId = '66666666-6666-4666-8666-666666666666';

test('«Правила участия»: ten rules, five questions, texts for everyone, no XP and no screenshot', () => {
  const rules = load('shared/domain/participation-rules.ts');
  assert.equal(rules.PARTICIPATION_RULES.length, 10);
  assert.equal(rules.PARTICIPATION_RULES_QUESTIONS.length, 5);
  for (const question of rules.PARTICIPATION_RULES_QUESTIONS) assert.equal(question.options.length, 3, question.title);
  const text = JSON.stringify([rules.PARTICIPATION_RULES, rules.PARTICIPATION_RULES_QUESTIONS, rules.PARTICIPATION_RULES_TASK_DESCRIPTION]) + read('frontend/features/member/StarterRulesGame.tsx');
  assert.doesNotMatch(text, /(^|[^а-яёА-ЯЁ])[Сс]ам([^а-яё]|$)|[Пп]рош[её]л|XP|скриншот/);
  assert.match(text, /обучение самостоятельно/);
  assert.match(text, /Блок пройден — открывается следующий\. Пропустить блок нельзя/);
  assert.match(text, /Предыдущий блок пройден — открывается следующий/);
  assert.match(text, /Мили начислены автоматически/);
  const catalog = load('shared/domain/ready-programs.ts').readyProgramByKey('starter-rules');
  assert.equal(catalog.title, 'Правила участия');
  assert.doesNotMatch(JSON.stringify(catalog), /XP|Правила игры/);
  assert.deepEqual([catalog.tasks[0].title, catalog.tasks[0].maxPoints, catalog.tasks[0].publicationType, catalog.tasks[0].interactiveKind],
    ['Правила участия', 5, 'evergreen', 'starter-rules']);
});

test('«Правила участия»: the database keeps the key, renames the published games and closes the old quiz path', () => {
  const { PARTICIPATION_RULES_QUESTIONS, PARTICIPATION_RULES_TASK_DESCRIPTION } = load('shared/domain/participation-rules.ts');
  const sql = read('supabase/20261120-participation-rules.sql');
  const spec = JSON.parse(sql.match(/when 'starter-rules' then '(\{[^']+\})'::jsonb/)[1]);
  assert.deepEqual(spec, { steps: 1, reward: 5, answers: PARTICIPATION_RULES_QUESTIONS.map(() => 0) });
  for (const kind of ['dream-plan', 'company-voyage', 'captain-cruise', 'free-membership', 'marketing-director']) assert.ok(sql.includes(`when '${kind}' then`), kind);
  assert.ok(read('supabase/20261131-participation-rules-retry.sql').includes(`set description = '${PARTICIPATION_RULES_TASK_DESCRIPTION}'`));
  assert.match(sql, /update public\.tasks set title = 'Правила участия' where interactive_kind = 'starter-rules' and title = 'Правила игры';/);
  assert.match(sql, /update public\.task_programs set title = 'Правила участия' where template_key = 'starter-rules' and title = 'Правила игры';/);
  assert.match(sql, /if task\.interactive_kind = 'starter-rules' then return jsonb_build_object\('validationError'/);
  assert.match(sql, /on conflict \(user_id, task_id, question\) do nothing/);
  assert.match(read('supabase/bootstrap.sql'), /\\ir 20261120-participation-rules\.sql\r?\n/);
  assert.match(read('.github/workflows/check.yml'), /20261120-participation-rules\.sql\r?\n\s+psql -X -v ON_ERROR_STOP=1 -f tests\/participation-rules\.sql/);
});

test('«Правила участия»: 20261131 lets a wrong answer be changed, gives all 5 miles once and keeps every text in step', () => {
  const sql = read('supabase/20261131-participation-rules-retry.sql');
  assert.match(sql, /on conflict \(user_id, task_id, question\) do update set answer = excluded\.answer/);
  assert.match(sql, /where participation_rule_answers\.answer is distinct from \(key->>participation_rule_answers\.question::int\)::int/, 'a right answer stays');
  assert.match(sql, /right_count >= total then/);
  assert.match(sql, /'Правила участия: все ' \|\| total \|\| ' ответов верные\. Ошибок: ' \|\| mistake_count \|\| '\.', total,/);
  assert.match(sql, /and description = 'Как проходить «Прокачку»: 10 правил участия и 5 вопросов\. За каждый верный ответ с первой попытки — 1 миля, всего до 5 миль автоматически\.';/);
  assert.doesNotMatch(sql, /app_ready_program_spec\(p_kind/, 'the reward list is left alone');
  assert.match(read('supabase/bootstrap.sql'), /\\ir 20261130-bally\.sql\r?\n\\ir 20261131-participation-rules-retry\.sql\r?\n/);
  assert.match(read('.github/workflows/check.yml'), /tests\/bally\.sql\r?\n\s+psql -X -v ON_ERROR_STOP=1 -f supabase\/20261131-participation-rules-retry\.sql\r?\n\s+psql -X -v ON_ERROR_STOP=1 -f tests\/participation-rules-retry\.sql/);
  const texts = JSON.stringify(load('shared/domain/participation-rules.ts')) + JSON.stringify(load('shared/domain/ready-programs.ts').readyProgramByKey('starter-rules')) + read('frontend/features/member/StarterRulesGame.tsx');
  assert.doesNotMatch(texts, /первой попытки/, 'no text promises miles only for the first try');
  assert.match(texts, /Ошибку можно исправить/);
});

test('«Правила участия»: the server action accepts only a start or one answer in range', async () => {
  const calls = [];
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/participation-rules.service': { participationRulesAction: async (...args) => {
      calls.push(args); return args[2] === 'answer' && args[3] === 4 ? { validationError: 'Тест недоступен для этого задания.' } : { data: { answers: {}, completed: false } };
    } },
  });
  const post = (body) => controller.postReadyProgramAttempt(new Request(`http://localhost/api/ready-programs/${taskId}/attempt`, { method: 'POST', body: JSON.stringify({ action: 'participation-rules', ...body }) }), taskId);
  for (const body of [{ operation: 'complete' }, { operation: 'answer', question: 5, answer: 0 }, { operation: 'answer', question: 0, answer: 3 },
    { operation: 'answer', question: '1', answer: 0 }, { operation: 'answer', question: 1 }, { operation: 'answer', question: -1, answer: 0 }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
  assert.equal((await post({ operation: 'start' })).status, 200);
  assert.equal((await post({ operation: 'answer', question: 2, answer: 1 })).status, 200);
  assert.deepEqual(calls.map((call) => call.slice(0, 5)), [['member', taskId, 'start', 0, 0], ['member', taskId, 'answer', 2, 1]]);
  const refused = await post({ operation: 'answer', question: 4, answer: 0 });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).message, /Тест недоступен/);
});

function setup(start = {}) {
  const harness = hookHarness();
  const queue = [];
  const previous = globalThis.window;
  globalThis.window = { setTimeout: (run) => { queue.push(run); return queue.length; }, clearTimeout() {} };
  const server = { answers: { ...(start.answers || {}) }, completed: Boolean(start.completed), earned: start.earned || 0, calls: [] };
  const state = () => {
    const rights = Object.fromEntries([0, 1, 2, 3, 4].filter((q) => server.completed || server.answers[q] === 0).map((q) => [q, 0]));
    const right = Object.values(server.answers).filter((answer) => answer === 0).length;
    return { answers: { ...server.answers }, rights, earnedPoints: server.completed ? server.earned : right, maxPoints: 5, completed: server.completed, submission: server.submission };
  };
  const api = { participationRulesAction: async (id, operation, question, answer) => {
    assert.equal(id, taskId);
    server.calls.push([operation, question, answer]);
    if (operation === 'answer' && !server.completed && server.answers[question] !== 0) {
      server.answers[question] = answer;
      if ([0, 1, 2, 3, 4].every((q) => server.answers[q] === 0)) {
        server.completed = true; server.earned = 5; server.submission = { id: 'result', points: 5 };
      }
    }
    return state();
  } };
  const css = { __esModule: true, default: new Proxy({}, { get: (_t, key) => key }) };
  const { StarterRulesGame } = load('frontend/features/member/StarterRulesGame.tsx', {
    react: { ...React, ...harness.react }, '@/frontend/shared/api/participation-rules-client': api, './StarterRulesGame.module.css': css,
  });
  const received = [];
  harness.mount(StarterRulesGame, { taskId, onCompleted: (submission) => received.push(submission) });
  const { PARTICIPATION_RULES_QUESTIONS: questions } = load('shared/domain/participation-rules.ts');
  const game = { server, received, tree: null, questions,
    async settle() { game.tree = await harness.settle(); return game.tree; },
    text() { return label(game.tree); },
    option(question, index) { return nodes(game.tree, (n) => n.type === 'button' && label(n).trim() === questions[question].options[index])[0]; },
    async pick(question, index) {
      const button = game.option(question, index);
      assert.ok(button, `option ${question}/${index}`);
      if (!button.props.disabled) await button.props.onClick();
      while (queue.length) queue.shift()();
      return game.settle();
    },
    done() { harness.unmount(); globalThis.window = previous; },
  };
  return game;
}

test('«Правила участия»: a wrong pick can be changed until it is right; all 5 miles come once, when every answer is right', async () => {
  const game = setup();
  try {
    await game.settle();
    assert.equal(nodes(game.tree, (n) => n.type === 'article').length, 10, 'ten rule cards');
    assert.match(game.text(), /Твои мили✈️ 0 \/ 5/);
    assert.match(game.text(), /За каждый верный ответ — 1 миля\. Если ответ неверный — выбери другой вариант\./);
    for (let question = 0; question < 5; question += 1) {
      const shown = nodes(game.tree, (n) => n.type === 'button' && game.questions[question].options.includes(label(n).trim())).map((n) => label(n).trim());
      assert.deepEqual([...shown].sort(), [...game.questions[question].options].sort(), 'all three options, in any order');
    }
    await game.pick(0, 2);
    assert.match(game.option(0, 2).props.className, /\bno\b/, 'the wrong pick is red');
    assert.ok(game.option(0, 2).props.disabled, 'the same wrong option is not sent again');
    assert.ok(!game.option(0, 0).props.disabled && !game.option(0, 1).props.disabled, 'the other options stay open');
    assert.ok([0, 1, 2].every((index) => !/\bok\b/.test(game.option(0, index).props.className)), 'the right option is not given away');
    assert.match(game.text(), /Не совсем\. Попробуй ещё раз — выбери другой вариант\./);
    assert.doesNotMatch(game.text(), /Не совсем\. Блок пройден/, 'no explanation before the right answer');
    await game.pick(0, 1);
    assert.match(game.option(0, 1).props.className, /\bno\b/);
    assert.doesNotMatch(game.option(0, 2).props.className, /\bno\b/, 'only the last wrong pick is red');
    await game.pick(0, 0);
    assert.match(game.option(0, 0).props.className, /\bok\b/, 'the right answer is green');
    assert.ok([0, 1, 2].every((index) => game.option(0, index).props.disabled), 'a right answer closes the question');
    assert.match(game.text(), /Верно! \+1 миля\. Блок пройден — открывается следующий\./);
    assert.match(game.text(), /✈️ 1 \/ 5/);
    assert.deepEqual(game.server.calls.filter((call) => call[0] === 'answer'), [['answer', 0, 2], ['answer', 0, 1], ['answer', 0, 0]]);
    await game.pick(1, 0); await game.pick(2, 0); await game.pick(3, 0); await game.pick(4, 1);
    assert.equal(game.received.length, 0, 'no miles while an answer is wrong');
    assert.doesNotMatch(game.text(), /Мили начислены/);
    assert.match(game.text(), /✈️ 4 \/ 5/);
    await game.pick(4, 0);
    assert.deepEqual(game.received, [{ id: 'result', points: 5 }]);
    assert.match(game.text(), /\+5 миль!/);
    assert.match(game.text(), /Мили начислены автоматически — они уже в твоём рейтинге\./);
    assert.ok(nodes(game.tree, (n) => n.props?.label === 'Перечитать правила').length, 'the rules can be read again');
  } finally { game.done(); }
});

test('«Правила участия»: a member who passed «Правила игры» keeps 5 miles and sees the rules with the right options', async () => {
  const game = setup({ completed: true, earned: 5 });
  try {
    await game.settle();
    assert.match(game.text(), /\+5 миль!/);
    assert.match(game.text(), /Правила уже пройдены, мили начислены\./);
    assert.match(game.text(), /✈️ 5 \/ 5/);
    for (let question = 0; question < 5; question += 1) {
      assert.match(game.option(question, 0).props.className, /\bok\b/);
      assert.ok(game.option(question, 1).props.disabled);
    }
    await game.pick(2, 1);
    assert.equal(game.server.calls.filter((call) => call[0] === 'answer').length, 0);
    assert.equal(game.received.length, 0);
  } finally { game.done(); }
});
