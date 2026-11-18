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
const taskId = '77777777-7777-4777-8777-777777777777';
const KEYS = [0, 2, 1, 2, 0, 2, 2, 0, 1, 2, 0];

test('«Финальный рейс уровня 1»: the route, the game list and the database agree; texts speak to everyone', () => {
  const voyage = load('shared/domain/final-voyage.ts');
  const steps = voyage.FINAL_VOYAGE_STEPS;
  assert.equal(steps.length, 12);
  assert.equal(steps[voyage.FINAL_VOYAGE_DREAM_STEP].kind, 'dream');
  const questions = steps.filter((step) => step.kind === 'question');
  assert.equal(questions.length, 11);
  for (const step of questions) assert.equal(step.options.length, 3, step.question);
  assert.deepEqual([...new Set(steps.map((step) => step.port))], [0, 1, 2, 3, 4, 5], 'six ports in order');
  const sql = read('supabase/20261121-final-voyage.sql');
  const spec = JSON.parse(sql.match(/when 'final-voyage-1' then '(\{[^']+\})'::jsonb/)[1]);
  assert.deepEqual(spec, { steps: 12, reward: voyage.FINAL_VOYAGE_REWARD, answers: KEYS });
  assert.ok(sql.includes(`game_title := '${voyage.FINAL_VOYAGE_TITLE}';`));
  assert.ok(sql.includes(`game_text := '${voyage.FINAL_VOYAGE_DESCRIPTION}';`));
  for (const kind of ['first-year', 'safety-watch', 'free-membership', 'marketing-director']) assert.ok(sql.includes(`p_kind = '${kind}' then`), kind);
  assert.match(sql, /when 'starter-rules' then '\{"steps":1,"reward":5,"answers":\[0,0,0,0,0\]\}'::jsonb/, 'the participation rules keep their key');
  assert.match(sql, /'marketing-director','final-voyage-1'\)\);/, 'the task kind is allowed');
  assert.match(sql, /dream_step constant integer := 9;/);
  assert.match(sql, /length\(until\)\) > 120/);
  assert.equal(voyage.FINAL_VOYAGE_DREAM_LIMIT, 120);
  const listed = load('shared/domain/program-games.ts').programGame('final-voyage-1');
  assert.deepEqual([listed.title, listed.reward, listed.minutes, listed.icon], ['Финальный рейс уровня 1', 5, 7, '🚢']);
  assert.equal(load('shared/domain/types.ts').isTaskInteractiveKind('final-voyage-1'), true);
  assert.match(read('supabase/bootstrap.sql'), /\\ir 20261121-final-voyage\.sql\r?\n/);
  assert.match(read('.github/workflows/check.yml'), /20261121-final-voyage\.sql\r?\n\s+psql -X -v ON_ERROR_STOP=1 -f tests\/final-voyage\.sql/);
  const text = read('shared/domain/final-voyage.ts') + read('frontend/features/member/FinalVoyageGame.tsx');
  assert.doesNotMatch(text, /(^|[^а-яёА-ЯЁ])[Сс]ам([^а-яё]|$)|[Пп]рош[её]л|[Дд]ош[её]л|забронировал |решил |Готов /);
  assert.doesNotMatch(text, /t\.me\/|скриншот/, 'the voice goes through the site, not a bare bot link');
  assert.match(text, /в кабинет захожу только я, плачу своей картой/);
  assert.match(text, /Круиз завершён — можно бронировать следующий/);
});

test('«Финальный рейс уровня 1»: the server action takes the current step, an option or three short dream lines', async () => {
  const calls = [];
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/final-voyage.service': { finalVoyageAction: async (...args) => {
      calls.push(args); return args[2] === 'complete' ? { validationError: 'Сначала дойди до финиша рейса.' } : { data: { step: 1 } };
    } },
  });
  const post = (body) => controller.postReadyProgramAttempt(new Request(`http://localhost/api/ready-programs/${taskId}/attempt`, { method: 'POST', body: JSON.stringify({ action: 'final-voyage', ...body }) }), taskId);
  const dream = { what: 'Круиз', price: '$6 000', when: '2028' };
  for (const body of [{ operation: 'jump' }, { operation: 'answer', step: 12, payload: { answer: 0 } }, { operation: 'answer', step: 0, payload: { answer: 3 } },
    { operation: 'answer', step: 0, payload: {} }, { operation: 'dream', step: 9, payload: { ...dream, price: ' ' } },
    { operation: 'dream', step: 9, payload: { ...dream, what: 'я'.repeat(121) } }, { operation: 'dream', step: 9, payload: { what: 'a', price: 'b' } }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
  assert.equal((await post({ operation: 'answer', step: 3, payload: { answer: 2 } })).status, 200);
  assert.equal((await post({ operation: 'dream', step: 9, payload: dream })).status, 200);
  assert.deepEqual(calls.map((call) => call.slice(0, 4)), [['member', taskId, 'answer', 3], ['member', taskId, 'dream', 9]]);
  const refused = await post({ operation: 'complete' });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).message, /Сначала дойди/);
});

// The game with a fake site that follows the SQL rules of app_final_voyage.
function setup(start = {}) {
  const harness = hookHarness();
  const queue = [];
  const previous = globalThis.window;
  globalThis.window = { setTimeout: (run) => { queue.push(run); return queue.length; }, clearTimeout() {}, location: { assign: (url) => server.opened.push(url) } };
  const server = { step: start.step || 0, mistakes: start.mistakes || 0, log: { ...(start.log || {}) }, dream: start.dream || { what: '', price: '', when: '' }, completed: Boolean(start.completed), calls: [], opened: [], voiceLinks: 0 };
  const state = (extra = {}) => ({ step: server.step, mistakes: server.mistakes, log: { ...server.log }, dream: { ...server.dream }, completed: server.completed,
    earnedPoints: server.completed ? 5 : 0, keys: server.completed ? KEYS : undefined, submission: server.submission, ...extra });
  const api = { finalVoyageAction: async (id, operation, step, payload) => {
    assert.equal(id, taskId);
    server.calls.push([operation, step, payload]);
    if (operation === 'answer') {
      assert.equal(step, server.step, 'the answer is for the current step');
      const right = payload.answer === KEYS[step - (step > 9 ? 1 : 0)];
      if (right) server.step += 1; else { server.mistakes += 1; server.log[step] = (server.log[step] || 0) + 1; server.step = Math.max(0, server.step - 1); }
      return state({ right });
    }
    if (operation === 'dream') { assert.equal(step, 9); server.dream = payload; server.step = 10; }
    if (operation === 'complete') { assert.equal(server.step, 12); server.completed = true; server.submission = { id: 'result', points: 5 }; }
    return state();
  } };
  const css = { __esModule: true, default: new Proxy({}, { get: (_t, key) => key }) };
  const { FinalVoyageGame } = load('frontend/features/member/FinalVoyageGame.tsx', {
    react: { ...React, ...harness.react }, '@/frontend/shared/api/final-voyage-client': api, './FinalVoyageGame.module.css': css,
    '@/frontend/shared/api/ready-program-client': { createCompanyVoiceLink: async (id) => { assert.equal(id, taskId); server.voiceLinks += 1; return { url: 'https://t.me/bot?start=company_voice_x' }; } },
  });
  const received = [];
  harness.mount(FinalVoyageGame, { taskId, onCompleted: (submission) => received.push(submission) });
  const { FINAL_VOYAGE_STEPS: steps } = load('shared/domain/final-voyage.ts');
  const game = { server, received, tree: null, steps,
    async settle() { game.tree = await harness.settle(); return game.tree; },
    text() { return label(game.tree); },
    buttons(predicate) { return nodes(game.tree, (n) => n.type === 'button' && predicate(n)); },
    async press(name) {
      const button = game.buttons((n) => typeof name === 'string' ? label(n).trim() === name : name(n))[0];
      assert.ok(button, `button «${name}»`); assert.equal(Boolean(button.props.disabled), false, `«${name}» is disabled`);
      await button.props.onClick(); while (queue.length) queue.shift()(); return game.settle();
    },
    option(index) { return game.buttons((n) => n.props['aria-pressed'] !== undefined)[index]; },
    async pick(index) { return game.press((n) => n === game.option(index)); },
    async type(placeholder, value) {
      const input = nodes(game.tree, (n) => n.type === 'input' && n.props.placeholder.includes(placeholder))[0];
      input.props.onChange({ target: { value } }); return game.settle();
    },
    done() { harness.unmount(); globalThis.window = previous; },
  };
  return game;
}

test('«Финальный рейс уровня 1»: a mistake moves one step back, the dream is kept, the miles come once at «Да, понятно»', async () => {
  const game = setup();
  try {
    await game.settle();
    assert.match(game.text(), /Первый уровень пройден!/);
    assert.match(game.text(), /Награда за финиш: ✈️ 5 миль/);
    await game.press('Поднять якорь 🚢');
    assert.match(game.text(), /Порт 1\. Компания/);
    assert.match(game.text(), /Шаг 1 из 12 · ошибок: 0/);
    await game.pick(1);
    assert.match(game.option(1).props.className, /\bwrong\b/);
    assert.ok([0, 1, 2].every((index) => game.option(index).props.disabled), 'one answer per try');
    assert.match(game.text(), /❌ Не совсем\. inCruises — международный клуб/);
    await game.press('Попробовать ещё раз');
    assert.match(game.text(), /Шаг 1 из 12 · ошибок: 1/);
    await game.pick(0);
    assert.match(game.option(0).props.className, /\bright\b/);
    assert.match(game.text(), /✅ Верно!/);
    await game.press('Дальше');
    assert.match(game.text(), /Если перестанешь платить/);
    await game.pick(0);
    await game.press('Вернуться на шаг назад');
    assert.match(game.text(), /казахстанская схема/, 'back to the first question');
    for (let step = 0; step < 9; step += 1) { await game.pick(KEYS[step]); await game.press('Дальше'); }
    assert.match(game.text(), /Заполни свою мечту:/);
    assert.ok(game.buttons((n) => label(n) === 'Дальше')[0].props.disabled, 'the dream needs all three lines');
    await game.type('круиз всей семьёй', 'Круиз всей семьёй'); await game.type('$6 000', '$6 000');
    assert.ok(game.buttons((n) => label(n) === 'Дальше')[0].props.disabled);
    await game.type('лето 2028', 'лето 2028');
    await game.press('Дальше');
    assert.deepEqual(game.server.dream, { what: 'Круиз всей семьёй', price: '$6 000', when: 'лето 2028' });
    await game.pick(0);
    await game.press('Вернуться на шаг назад');
    assert.match(game.text(), /Заполни свою мечту:/);
    assert.equal(nodes(game.tree, (n) => n.type === 'input')[0].props.value, 'Круиз всей семьёй', 'the dream stays filled in');
    await game.press('Дальше');
    await game.pick(2); await game.press('Дальше');
    await game.pick(0);
    assert.equal(game.received.length, 0);
    await game.press('Дальше');
    assert.match(game.text(), /Финиш!Ошибок за игру: 3/);
    assert.match(game.text(), /Где были ошибки/);
    assert.match(game.text(), /Сколько стоит партнёрство[^]*Партнёрство всегда стоит \$95 за полгода/);
    assert.doesNotMatch(game.text(), /Заполни свою мечту/);
    await game.press('Да, понятно');
    assert.deepEqual(game.received, [{ id: 'result', points: 5 }]);
    assert.match(game.text(), /✈️ \+5 миль/);
    assert.match(game.text(), /Уровень 1 пройден!/);
    await game.press('🎙️ Записать голосовое наставнику');
    assert.equal(game.server.voiceLinks, 1);
    assert.deepEqual(game.server.opened, ['https://t.me/bot?start=company_voice_x']);
    const material = nodes(game.tree, (n) => n.type?.name === 'MaterialButton')[0];
    assert.ok(material, 'the material button is on the result screen');
    material.props.onClick(); await game.settle();
    assert.ok(nodes(game.tree, (n) => n.type?.name === 'MaterialBar').length, 'the material says it is a reading mode');
    assert.match(game.text(), /Моя мечта🎯 Круиз всей семьёй💰 \$6 000📅 лето 2028/);
    const marked = nodes(game.tree, (n) => n.type === 'p' && /\bright\b/.test(n.props.className || '')).map(label);
    assert.equal(marked.length, 11, 'every question shows its right option');
    assert.ok(marked.includes('в)$95 каждые полгода — и при входе, и при продлении'));
    await game.press('← К результату');
    assert.match(game.text(), /Уровень 1 пройден!/);
    assert.equal(game.server.calls.filter(([operation]) => operation === 'complete').length, 1);
  } finally { game.done(); }
});

test('«Финальный рейс уровня 1»: the game opens where it stopped', async () => {
  const atFinish = setup({ step: 12, mistakes: 0 });
  try { await atFinish.settle(); assert.match(atFinish.text(), /Финиш!Ошибок за игру: 0/); assert.doesNotMatch(atFinish.text(), /Где были ошибки/); }
  finally { atFinish.done(); }
  const middle = setup({ step: 4, mistakes: 1, log: { 2: 1 } });
  try { await middle.settle(); assert.match(middle.text(), /Шаг 5 из 12 · ошибок: 1/); assert.match(middle.text(), /Порт 3\. Бронирование/); }
  finally { middle.done(); }
  const passed = setup({ step: 12, completed: true, dream: { what: 'Дом', price: '1', when: '2030' } });
  try {
    await passed.settle();
    assert.match(passed.text(), /✈️ \+5 миль/);
    assert.equal(passed.server.calls.length, 1, 'only the start');
    assert.equal(passed.received.length, 0);
  } finally { passed.done(); }
});
