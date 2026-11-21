// «Тренажёр «Я подумаю»» (database rules: tests/podumayu.sql).
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
const taskId = '88888888-8888-4888-8888-888888888888';
const KEYS = { answers: [2, 2, 2], sort: [true, false, true, false] };

test('«Я подумаю»: the rounds, the game list and the database agree; texts speak to everyone', () => {
  const data = load('shared/domain/podumayu.ts');
  const rounds = data.PODUMAYU_ROUNDS;
  assert.deepEqual(rounds.map((round) => round.kind), ['chat', 'chat', 'chat', 'sort']);
  assert.equal(data.PODUMAYU_SORT_STEP, 3);
  for (const round of rounds.slice(0, 3)) assert.equal(round.options.length, 4, round.title);
  assert.equal(rounds[3].phrases.length, 4);
  const sql = read('supabase/20261125-podumayu.sql');
  const spec = JSON.parse(sql.match(/when 'podumayu' then '(\{[^']+\})'::jsonb/)[1]);
  assert.deepEqual(spec, { steps: 4, reward: data.PODUMAYU_REWARD, ...KEYS });
  assert.ok(sql.includes(`game_title := '${data.PODUMAYU_TITLE}';`));
  assert.ok(sql.includes(`game_text := '${data.PODUMAYU_DESCRIPTION}';`));
  for (const kind of ['first-year', 'safety-watch', 'free-membership', 'marketing-director', 'final-voyage-1']) assert.ok(sql.includes(`p_kind = '${kind}' then`), kind);
  for (const kind of ['dream-plan', 'starter-rules', 'company-voyage', 'captain-cruise', 'count-your-dream', 'dream-route', 'first-year', 'safety-watch', 'free-membership', 'marketing-director', 'final-voyage-1'])
    assert.ok(sql.includes(`when '${kind}' then`), 'the reward list keeps ' + kind);
  assert.match(sql, /'final-voyage-1','podumayu'\)\);/, 'the task kind is allowed');
  assert.equal((sql.match(/'dream-route','final-voyage-1','podumayu'\)/g) || []).length, 2, 'the voice works for the trainer');
  const listed = load('shared/domain/program-games.ts').programGame('podumayu');
  assert.deepEqual([listed.title, listed.reward, listed.minutes, listed.icon], ['Тренажёр «Я подумаю»', 1, 6, '💭']);
  assert.equal(load('shared/domain/types.ts').isTaskInteractiveKind('podumayu'), true);
  assert.match(read('supabase/bootstrap.sql'), /\\ir 20261125-podumayu\.sql\r?\n/);
  assert.match(read('.github/workflows/check.yml'), /20261125-podumayu\.sql\r?\n\s+psql -X -v ON_ERROR_STOP=1 -f tests\/podumayu\.sql/);
  assert.match(read('frontend/features/member/TaskCard.tsx'), /interactiveKind === "podumayu" && <PodumayuGame taskId=\{task\.id\} onCompleted=\{onInteractiveComplete\} \/>/);
  const text = read('shared/domain/podumayu.ts') + read('frontend/features/member/PodumayuGame.tsx');
  assert.doesNotMatch(text, /[Оо]тпустил |[Пп]олучил |[Пп]ринял<|Узнал причину<|Назначил |объяснял час/, 'feedback is not written to a man only');
  assert.doesNotMatch(text, /t\.me\/|INCRUISES_PROKACHKA_BOT/, 'the voice goes through the site, not a bare bot link');
  assert.doesNotMatch(text, /Пройти ещё раз/, 'no replay without a mile');
  assert.match(text, /Почти никто не перезванивает сам/);
  assert.match(text, /Сначала узнай, что не подошло, а потом предлагай/);
});

test('«Я подумаю»: the server action takes the current round, an option 0–3 or a phrase with true/false', async () => {
  const calls = [];
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/podumayu.service': { podumayuAction: async (...args) => {
      calls.push(args); return args[2] === 'complete' ? { validationError: 'Сначала пройди все 4 раунда.' } : { data: { step: 1 } };
    } },
  });
  const post = (body) => controller.postReadyProgramAttempt(new Request(`http://localhost/api/ready-programs/${taskId}/attempt`, { method: 'POST', body: JSON.stringify({ action: 'podumayu', ...body }) }), taskId);
  for (const body of [{ operation: 'jump' }, { operation: 'dream' }, { operation: 'answer', step: 4, payload: { answer: 0 } }, { operation: 'answer', step: 0, payload: { answer: 4 } },
    { operation: 'answer', step: 0, payload: {} }, { operation: 'mark', step: 3, payload: { item: 4, good: true } }, { operation: 'mark', step: 3, payload: { item: 0, good: 'yes' } },
    { operation: 'mark', step: 3, payload: { item: 0 } }, { operation: 'answer', step: 0, payload: [2] }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
  assert.equal((await post({ operation: 'answer', step: 1, payload: { answer: 3 } })).status, 200);
  assert.equal((await post({ operation: 'mark', step: 3, payload: { item: 2, good: false } })).status, 200);
  assert.deepEqual(calls.map((call) => call.slice(0, 5)), [['member', taskId, 'answer', 1, { answer: 3 }], ['member', taskId, 'mark', 3, { item: 2, good: false }]]);
  const refused = await post({ operation: 'complete' });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).message, /Сначала пройди все 4 раунда/);
});

// The trainer with a fake site that follows the SQL rules of app_podumayu.
function setup(start = {}) {
  const harness = hookHarness();
  const queue = [];
  const previous = globalThis.window;
  globalThis.window = { setTimeout: (run) => { queue.push(run); return queue.length; }, clearTimeout() {}, location: { assign: (url) => server.opened.push(url) } };
  const server = { step: start.step || 0, mistakes: start.mistakes || 0, marks: { ...(start.marks || {}) }, completed: Boolean(start.completed), calls: [], opened: [], voiceLinks: 0 };
  const state = (extra = {}) => ({ step: server.step, mistakes: server.mistakes, completed: server.completed, earnedPoints: server.completed ? 1 : 0,
    marks: Object.fromEntries(Object.entries(server.marks).map(([item, good]) => [Number(item), { good, right: good === KEYS.sort[item] }])),
    keys: server.completed ? KEYS : undefined, submission: server.submission, ...extra });
  const api = { podumayuAction: async (id, operation, step, payload) => {
    assert.equal(id, taskId);
    server.calls.push([operation, step, payload]);
    if (operation === 'answer') {
      assert.equal(step, server.step, 'the answer is for the current round');
      const right = payload.answer === KEYS.answers[step];
      if (right) server.step += 1; else server.mistakes += 1;
      return state({ right });
    }
    if (operation === 'mark') {
      assert.equal(step, 3); assert.equal(server.step, 3, 'marks only in the sorting round');
      assert.equal(payload.item in server.marks, false, 'a phrase is sent once');
      const right = payload.good === KEYS.sort[payload.item];
      server.marks[payload.item] = payload.good;
      if (!right) server.mistakes += 1;
      if (Object.keys(server.marks).length === 4) server.step = 4;
      return state({ right });
    }
    if (operation === 'complete') { assert.equal(server.step, 4); server.completed = true; server.submission = { id: 'result', points: 1 }; }
    return state();
  } };
  const css = { __esModule: true, default: new Proxy({}, { get: (_t, key) => key }) };
  const { PodumayuGame } = load('frontend/features/member/PodumayuGame.tsx', {
    react: { ...React, ...harness.react }, '@/frontend/shared/api/podumayu-client': api, './PodumayuGame.module.css': css,
    '@/frontend/shared/api/ready-program-client': { createCompanyVoiceLink: async (id) => { assert.equal(id, taskId); server.voiceLinks += 1; return { url: 'https://t.me/bot?start=company_voice_x' }; } },
  });
  const received = [];
  harness.mount(PodumayuGame, { taskId, onCompleted: (submission) => received.push(submission) });
  const game = { server, received, tree: null,
    async settle() { game.tree = await harness.settle(); return game.tree; },
    text() { return label(game.tree); },
    buttons(predicate) { return nodes(game.tree, (n) => n.type === 'button' && predicate(n)); },
    async press(name) {
      const button = game.buttons((n) => typeof name === 'string' ? label(n).trim() === name : name(n))[0];
      assert.ok(button, `button «${name}»`); assert.equal(Boolean(button.props.disabled), false, `«${name}» is disabled`);
      await button.props.onClick(); while (queue.length) queue.shift()(); return game.settle();
    },
    option(index) { return game.buttons((n) => /\bopt\b/.test(n.props.className || ''))[index]; },
    async pick(index) { return game.press((n) => n === game.option(index)); },
    async mark(index, good) { return game.press((n) => n === game.buttons((b) => label(b) === (good ? '👍 Помогает' : '👎 Вредит'))[index]); },
    done() { harness.unmount(); globalThis.window = previous; },
  };
  return game;
}

test('«Я подумаю»: wrong picks show their comment, the right one opens «Дальше», the mile comes once', async () => {
  const game = setup();
  try {
    await game.settle();
    assert.match(game.text(), /«Я подумаю» — самое частое возражение в нашей команде/);
    assert.match(game.text(), /получишь ✈️ 1 милю/);
    assert.match(game.text(), /✈️ 0\/1/);
    await game.press('Начать тренировку');
    assert.match(game.text(), /Раунд 1 из 4/);
    assert.match(game.text(), /КлиентВсё интересно, правда\. Но мне надо подумать\./);
    await game.pick(0);
    assert.match(game.option(0).props.className, /\bbad\b/);
    assert.match(game.text(), /Не совсем\. Попробуй ещё разТак человек уходит «в свободное плавание»/);
    assert.equal(game.buttons((n) => label(n) === 'Дальше →').length, 0, 'no «Дальше» before the right answer');
    await game.pick(0);
    assert.equal(game.server.calls.filter(([operation]) => operation === 'answer').length, 1, 'the same wrong option is not sent twice');
    await game.pick(2);
    assert.match(game.option(2).props.className, /\bgood\b/);
    assert.match(game.text(), /Верно!Ты не споришь и не давишь/);
    assert.match(game.text(), /Можешь нажать и на другие варианты/);
    await game.pick(3);
    assert.match(game.text(), /Что будет, если сказать такЭто давление/);
    assert.equal(game.server.calls.filter(([operation]) => operation === 'answer').length, 2, 'after the right answer the others are only shown');
    await game.press('Дальше →');
    assert.match(game.text(), /Раунд 2 из 4/);
    assert.match(game.text(), /Ты…Что из этого ближе тебе\?/);
    await game.pick(2); await game.press('Дальше →');
    await game.pick(2); await game.press('Дальше →');
    assert.match(game.text(), /Раунд 4\. Помогает или вредит\?/);
    await game.mark(1, true);
    assert.match(game.text(), /Не совсемВредит: Искусственная спешка/);
    assert.equal(game.buttons((n) => label(n) === 'Дальше →').length, 0);
    await game.mark(1, false);
    assert.match(game.text(), /Верно!Вредит: Искусственная спешка/, 'the second mark shows the other side without the site');
    await game.mark(0, true); await game.mark(2, true);
    assert.equal(game.buttons((n) => label(n) === 'Дальше →').length, 0, '«Дальше» waits for every phrase');
    await game.mark(3, false);
    assert.equal(game.server.calls.filter(([operation]) => operation === 'mark').length, 4);
    assert.equal(game.received.length, 0);
    await game.press('Дальше →');
    assert.match(game.text(), /Тренажёр пройден 🎉/);
    assert.match(game.text(), /«Подумаю» — это не «нет»\.Это «помоги мне понять»\./);
    assert.match(game.text(), /Назначить следующий шаг: звонок через 2–3 дня, не позже\./);
    await game.press('Забрать ✈️ 1 милю');
    assert.deepEqual(game.received, [{ id: 'result', points: 1 }]);
    assert.match(game.text(), /✈️ \+1 миля зачислена!/);
    assert.match(game.text(), /✈️ 1\/1/);
    assert.match(game.text(), /Голосовое на 1 минуту/);
    await game.press('🎙️ Записать голосовое наставнику');
    assert.equal(game.server.voiceLinks, 1);
    assert.deepEqual(game.server.opened, ['https://t.me/bot?start=company_voice_x']);
    const material = nodes(game.tree, (n) => n.type?.name === 'MaterialButton')[0];
    assert.equal(material.props.label, 'Перечитать разбор');
    material.props.onClick(); await game.settle();
    assert.ok(nodes(game.tree, (n) => n.type?.name === 'MaterialBar').length, 'the material says it is a reading mode');
    const right = nodes(game.tree, (n) => n.type === 'div' && /\bgood\b/.test(n.props.className || '')).map(label);
    assert.equal(right.length, 3, 'each dialogue round shows its right option');
    assert.ok(right[2].startsWith('Этот вариант ему не подошёл.'));
    assert.match(game.text(), /«Ты что, сам не можешь ничего решить\?»👎 Вредит: Унижает человека/);
    await game.press('← К результату');
    assert.match(game.text(), /Голосовое на 1 минуту/);
    assert.equal(game.server.calls.filter(([operation]) => operation === 'complete').length, 1);
  } finally { game.done(); }
});

test('«Я подумаю»: the trainer opens where it stopped', async () => {
  const middle = setup({ step: 3, mistakes: 1, marks: { 0: true, 1: true } });
  try {
    await middle.settle();
    assert.match(middle.text(), /Раунд 4 из 4/);
    assert.match(middle.text(), /Верно!Помогает: Объясняешь/);
    assert.match(middle.text(), /Не совсемВредит: Искусственная спешка/);
    await middle.mark(1, false);
    assert.equal(middle.server.calls.length, 1, 'a phrase marked before the reload is not sent again');
  } finally { middle.done(); }
  const atFinish = setup({ step: 4, mistakes: 0 });
  try { await atFinish.settle(); assert.match(atFinish.text(), /Забрать ✈️ 1 милю/); } finally { atFinish.done(); }
  const passed = setup({ step: 4, completed: true });
  try {
    await passed.settle();
    assert.match(passed.text(), /✈️ \+1 миля зачислена!/);
    assert.equal(passed.server.calls.length, 1, 'only the start');
    assert.equal(passed.received.length, 0);
  } finally { passed.done(); }
});
