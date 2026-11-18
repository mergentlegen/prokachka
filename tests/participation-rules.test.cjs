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
  assert.ok(sql.includes(`set description = '${PARTICIPATION_RULES_TASK_DESCRIPTION}'`));
  assert.match(sql, /update public\.tasks set title = 'Правила участия' where interactive_kind = 'starter-rules' and title = 'Правила игры';/);
  assert.match(sql, /update public\.task_programs set title = 'Правила участия' where template_key = 'starter-rules' and title = 'Правила игры';/);
  assert.match(sql, /if task\.interactive_kind = 'starter-rules' then return jsonb_build_object\('validationError'/);
  assert.match(sql, /on conflict \(user_id, task_id, question\) do nothing/);
  assert.match(read('supabase/bootstrap.sql'), /\\ir 20261120-participation-rules\.sql\s*$/);
  assert.match(read('.github/workflows/check.yml'), /20261120-participation-rules\.sql\r?\n\s+psql -X -v ON_ERROR_STOP=1 -f tests\/participation-rules\.sql/);
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
    const rights = Object.fromEntries([0, 1, 2, 3, 4].filter((q) => server.completed || server.answers[q] !== undefined).map((q) => [q, 0]));
    const right = Object.values(server.answers).filter((answer) => answer === 0).length;
    return { answers: { ...server.answers }, rights, earnedPoints: server.completed ? server.earned : right, maxPoints: 5, completed: server.completed, submission: server.submission };
  };
  const api = { participationRulesAction: async (id, operation, question, answer) => {
    assert.equal(id, taskId);
    server.calls.push([operation, question, answer]);
    if (operation === 'answer' && !server.completed && server.answers[question] === undefined) {
      server.answers[question] = answer;
      if (Object.keys(server.answers).length === 5) {
        server.completed = true; server.earned = Object.values(server.answers).filter((value) => value === 0).length;
        server.submission = { id: 'result', points: server.earned };
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

test('«Правила участия»: one try per question, the right option is shown, the miles come once at the fifth answer', async () => {
  const game = setup();
  try {
    await game.settle();
    assert.equal(nodes(game.tree, (n) => n.type === 'article').length, 10, 'ten rule cards');
    assert.match(game.text(), /Твои мили✈️ 0 \/ 5/);
    for (let question = 0; question < 5; question += 1) {
      const shown = nodes(game.tree, (n) => n.type === 'button' && game.questions[question].options.includes(label(n).trim())).map((n) => label(n).trim());
      assert.deepEqual([...shown].sort(), [...game.questions[question].options].sort(), 'all three options, in any order');
    }
    await game.pick(0, 2);
    assert.match(game.option(0, 2).props.className, /\bno\b/, 'the wrong pick is red');
    assert.match(game.option(0, 0).props.className, /\bok\b/, 'the right option is green');
    assert.ok([0, 1, 2].every((index) => game.option(0, index).props.disabled), 'a question has one try');
    assert.match(game.text(), /Не совсем\. Блок пройден — открывается следующий\./);
    assert.doesNotMatch(game.option(1, 0).props.className, /\bok\b/, 'unanswered questions do not show the right option');
    await game.pick(0, 0);
    assert.deepEqual(game.server.calls.filter((call) => call[0] === 'answer'), [['answer', 0, 2]], 'the second click is not sent');
    await game.pick(1, 0);
    assert.match(game.text(), /Верно! \+1 миля\. Дедлайнов нет\./);
    assert.match(game.text(), /✈️ 1 \/ 5/);
    await game.pick(2, 0); await game.pick(3, 1);
    assert.equal(game.received.length, 0, 'no miles before the fifth answer');
    assert.doesNotMatch(game.text(), /Мили начислены/);
    await game.pick(4, 0);
    assert.deepEqual(game.received, [{ id: 'result', points: 3 }]);
    assert.match(game.text(), /\+3 мили!/);
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
