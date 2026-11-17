const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./helpers/load-ts.cjs');
const { setupTrainer, nodes, label, task } = require('./helpers/cabinet-trainer.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const program = '55555555-5555-4555-8555-555555555555';

test('«Безоплатное членство»: the trainer, the game list and the database agree on answers, miles and texts', () => {
  const game = load('shared/domain/free-membership.ts');
  const sql = read('supabase/20261118-free-membership.sql');
  assert.equal(game.FREE_MEMBERSHIP_MISSIONS.length, 7);
  assert.equal(game.FREE_MEMBERSHIP_QUIZ.length, 5);
  assert.equal(game.FREE_MEMBERSHIP_REWARD, 2, 'two miles, as in the author file');
  const spec = JSON.parse(sql.match(/when 'free-membership' then '(\{[^']+\})'::jsonb/)[1]);
  assert.deepEqual(spec, { steps: 7, reward: 2, answers: game.FREE_MEMBERSHIP_QUIZ.map((question) => question.right) });
  // The questions after missions: the database knows the same right options.
  const keys = Object.fromEntries([...sql.match(/select case p_mission (.+?) else null end;/)[1].matchAll(/when (\d) then (\d)/g)].map((match) => [match[1], Number(match[2])]));
  const asked = Object.fromEntries(game.FREE_MEMBERSHIP_MISSIONS.flatMap((mission, index) => mission.ask ? [[String(index + 1), mission.ask.right]] : []));
  assert.deepEqual(keys, asked);
  for (const mission of game.FREE_MEMBERSHIP_MISSIONS) if (mission.ask) assert.ok(mission.ask.right < mission.ask.opts.length, mission.ask.q);
  for (const question of game.FREE_MEMBERSHIP_QUIZ) assert.ok(question.right < question.opts.length, question.q);
  // The step a mentor adds says the same as the game list.
  assert.ok(sql.includes(`game_title := '${game.FREE_MEMBERSHIP_TITLE}';`));
  assert.ok(sql.includes(`game_text := '${game.FREE_MEMBERSHIP_DESCRIPTION}';`));
  assert.match(sql, /'safety-watch','free-membership'\)\);/, 'the task kind is allowed');
  assert.match(sql, /when 'captain-cruise' then '\{"steps":1,"reward":10,"answers":\[\]\}'::jsonb/, 'the other games keep their rewards');
  const games = load('shared/domain/program-games.ts');
  const listed = games.programGame('free-membership');
  assert.deepEqual([listed.title, listed.reward, listed.icon], ['Безоплатное членство', 2, '🎁']);
  const types = load('shared/domain/types.ts');
  assert.equal(types.isTaskInteractiveKind('free-membership'), true);
  assert.match(read('supabase/bootstrap.sql'), /\\ir 20261118-free-membership\.sql\r?\n/);
  assert.match(read('.github/workflows/check.yml'), /20261118-free-membership\.sql\n\s+psql -X -v ON_ERROR_STOP=1 -f tests\/free-membership\.sql/);
});

test('«Безоплатное членство»: mistakes are written in short keys and read back as the author’s lines', () => {
  const { trainerErrorLabel, trainerAskKeys } = load('shared/domain/cabinet-trainer.ts');
  const { FREE_MEMBERSHIP_TRAINER } = load('shared/domain/free-membership.ts');
  const errorLabel = (key) => trainerErrorLabel(FREE_MEMBERSHIP_TRAINER, key);
  assert.equal(errorLabel('m1'), 'Миссия 1: Найди, сколько дней осталось до конца твоего ЛИЧНОГО месяца.');
  assert.equal(errorLabel('q5'), 'Итоговая проверка: Что ты получаешь, когда набираешь $500?');
  for (const key of ['m0', 'm8', 'q6', 'x', '__proto__', 'm10']) assert.equal(errorLabel(key), null, key);
  assert.deepEqual(trainerAskKeys(FREE_MEMBERSHIP_TRAINER), { 2: 1, 6: 1, 7: 1 });
  // Texts speak to everyone, not only to men.
  const source = read('shared/domain/free-membership.ts');
  assert.doesNotMatch(source, /Нашёл|ты набрал|Ты открыл|ты пригласил /);
});

test('«Безоплатное членство» requests are checked before they reach the database', async () => {
  const calls = [];
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'm', role: 'member', teamId: 'team' }) },
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (...args) => { calls.push(args); return { data: { step: 1, completed: false }, error: null }; } }) },
  });
  const post = (body) => controller.postReadyProgramAttempt(new Request('http://localhost/api/ready-programs/' + task + '/attempt', { method: 'POST', body: JSON.stringify(body) }), task);
  for (const body of [
    { operation: 'cheat' }, { operation: 'save', step: 8 }, { operation: 'save', step: 1.5 }, { operation: 'save', step: 2, payload: { answer: 7 } },
    { operation: 'complete', payload: { answers: [1, 1, 1, 1, 0, 0] } }, { operation: 'save', step: 1, payload: { errors: -1 } }, { operation: 'save', step: 1, payload: { hints: 1000 } },
    { operation: 'save', step: 1, payload: { log: { m9: 1 } } }, { operation: 'save', step: 1, payload: { log: [] } }, { operation: 'save', step: 1, payload: [] },
  ]) assert.equal((await post({ action: 'free-membership', ...body })).status, 400, JSON.stringify(body));
  assert.equal(calls.length, 0);
  assert.equal((await post({ action: 'free-membership', operation: 'save', step: 2, payload: { answer: 1, errors: 2, hints: 1, log: { m1: 1, m2: 1 } }, userId: 'forged' })).status, 200);
  assert.deepEqual(calls[0], ['app_free_membership', { p_user_id: 'm', p_task_id: task, p_action: 'save', p_step: 2, p_payload: { answer: 1, errors: 2, hints: 1, log: { m1: 1, m2: 1 } } }]);
});

test('a mentor can put «Безоплатное членство» into a program', async () => {
  const rpc = [];
  const controller = load('backend/controllers/program-steps.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'a', role: 'admin', teamId: 'team', name: 'Асель' }) },
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (name, args) => { rpc.push([name, args]); return { data: { data: { id: task }, reopened: 0 }, error: null }; } }) },
    '@/backend/services/audit-log.service': { auditRecord: async () => ({ teamId: 'team' }), recordAudit: async (_user, entry) => { rpc.push(['audit', entry.targetLabel]); } },
  });
  const req = new Request('http://localhost/api/programs/' + program + '/games', { method: 'POST', body: JSON.stringify({ kind: 'free-membership' }) });
  assert.equal((await controller.addProgramGame(req, program)).status, 201);
  assert.deepEqual(rpc, [['app_program_add_game', { p_actor: 'a', p_program: program, p_kind: 'free-membership' }], ['audit', 'Игра «Безоплатное членство»']]);
});

// The game with a fake site that follows app_free_membership, and timers run by hand.
const setup = (start) => setupTrainer({ data: 'shared/domain/free-membership.ts', trainer: 'FREE_MEMBERSHIP_TRAINER', game: 'frontend/features/member/FreeMembershipGame.tsx', screens: 'freeMembershipCabinet' }, start);

test('the trainer plays from the first mission to the miles, with hints, mistakes and the step back in the check', async () => {
  const game = setup();
  try {
    await game.settle();
    assert.match(game.text(), /Безоплатное членство: кто уже оплатил\?/);
    await game.press('Начать тренажёр');
    assert.match(game.text(), /Миссия 1 из 7/); assert.match(game.text(), /Понятно, ищу!/);
    await game.press('Понятно, ищу!');
    assert.doesNotMatch(game.text(), /Понятно, ищу!/, 'the mission card closes; the task stays at the bottom');
    // A miss: the author's hint for that place, one mistake.
    await game.tap('timerCal');
    assert.match(game.text(), /Это календарный месяц — он одинаковый для всех/); assert.match(game.text(), /Ошибок: 1/);
    await game.press('💡 Подсказка');
    assert.match(game.text(), /Смотри, где мигает ✨/);
    assert.equal(nodes(game.tree, (n) => n.props?.['data-hot'] === 'timerPers')[0].props.className.includes('pulse'), true, 'the right timer lights up');
    await game.tap('timerPers');
    assert.match(game.text(), /✅ Верно! Это твой личный месяц/);
    await game.press('Дальше');
    assert.deepEqual(game.server.calls.at(-1), ['save', 1, { errors: 1, hints: 1, log: { m1: 1 } }]);
    // Mission 2 asks a question: a wrong option shows why, the right one opens «Дальше».
    await game.press('Понятно, ищу!');
    await game.tap('money');
    assert.equal(nodes(game.tree, (n) => n.type === 'button' && label(n) === 'Дальше').length, 0, 'no way on before the answer');
    await game.press('$500');
    assert.match(game.text(), /Нужно \$500, набрано \$450/);
    await game.flush();
    assert.match(game.text(), /Нужно \$500, набрано \$450/, 'the explanation stays after the red flash');
    await game.press('$50');
    await game.press('Дальше');
    assert.deepEqual(game.server.calls.at(-1), ['save', 2, { answer: 1, errors: 2, hints: 1, log: { m1: 1, m2: 1 } }]);
    // Mission 3: the avatars open the list of people.
    await game.press('Понятно, ищу!'); await game.tap('avatars');
    assert.match(game.text(), /Список открыт!/); assert.match(game.text(), /Члены \(Личные\)/);
    await game.press('Дальше');
    await game.press('Понятно, ищу!'); await game.tap('typeMadina');
    assert.match(game.text(), /Это план Мадины/);
    await game.tap('typeDaniyar'); await game.press('Дальше');
    // Mission 5: the table has to be scrolled; a tap only explains how.
    await game.press('Понятно, ищу!'); await game.tap('sumKarim');
    assert.match(game.text(), /Не нажимай — проведи пальцем по таблице/);
    const table = nodes(game.tree, (n) => typeof n.props?.onScroll === 'function')[0];
    table.props.ref.current = { scrollWidth: 640, clientWidth: 396, scrollLeft: 100, contains: () => true, classList: { add() {}, remove() {} } };
    table.props.onScroll(); await game.flush();
    assert.doesNotMatch(game.text(), /✅ Отлично!/, 'not far enough');
    table.props.ref.current.scrollLeft = 220; table.props.onScroll(); await game.flush();
    assert.match(game.text(), /✅ Отлично!/);
    await game.press('Дальше');
    for (const [spot, wrong, right] of [['sumDaniyar', 'Это ошибка кабинета', 'У Данияра самого безоплатное членство: он платит на $100 меньше, и в зачёт идёт то, что он реально оплатил'], ['sumKarim', null, '$450']]) {
      await game.press('Понятно, ищу!'); await game.tap(spot);
      if (wrong) { await game.press(wrong); await game.flush(); }
      await game.press(right); await game.press('Дальше');
    }
    assert.deepEqual(game.server.calls.filter(([operation]) => operation === 'save').map(([, step]) => step), [1, 2, 3, 4, 5, 6, 7]);
    // The check: a mistake takes one question back.
    assert.match(game.text(), /Проверка · 1 из 5/);
    await game.press(game.quiz[0].opts[1]); await game.flush();
    assert.match(game.text(), /Проверка · 2 из 5/);
    await game.press(game.quiz[1].opts[0]);
    assert.match(game.text(), /Неверно\. Возвращаемся на шаг назад/);
    await game.flush();
    assert.match(game.text(), /Проверка · 1 из 5/);
    for (const question of game.quiz) { await game.press(question.opts[question.right]); await game.flush(); }
    // The results: every mistake by place, then the miles once.
    assert.match(game.text(), /Твои итоги/); assert.match(game.text(), /Подсказок взято: 1\./);
    assert.match(game.text(), /Миссия 1: Найди, сколько дней осталось до конца твоего ЛИЧНОГО месяца\. — ошибок: 1/);
    assert.match(game.text(), /Итоговая проверка: Сколько прямого объёма нужно набрать за личный месяц\? — ошибок: 1/);
    assert.equal(game.received.length, 0);
    await game.press('Да, понятно');
    assert.deepEqual(game.server.calls.at(-1)[2].log, { m1: 1, m2: 1, m4: 1, m6: 1, q2: 1 });
    assert.equal(game.received.length, 1); assert.equal(game.received[0].points, 2);
    assert.match(game.text(), /Тренажёр завершён!/); assert.match(game.text(), /\+2/); assert.match(game.text(), /Следующий шаг программы уже открыт/);
    assert.equal(nodes(game.tree, (n) => n.type?.name === 'MaterialButton').length, 1, 'the material button is there');
    // Playing again is practice: nothing is sent.
    const sent = game.server.calls.length;
    await game.press('↻ Пройти ещё раз'); await game.press('Понятно, ищу!'); await game.tap('timerPers'); await game.press('Дальше');
    assert.equal(game.server.calls.length, sent, 'practice sends nothing');
  } finally { game.done(); }
});

test('the trainer continues where it stopped, and a finished one opens on its result', async () => {
  const resumed = setup({ missions: 3, stats: { errors: 2, hints: 0, log: { m2: 2 } } });
  try {
    await resumed.settle();
    assert.match(resumed.text(), /Пройдено миссий: 3 из 7/);
    await resumed.press('Продолжить с миссии 4');
    assert.match(resumed.text(), /Миссия 4 из 7/); assert.match(resumed.text(), /Найди, какой план членства у Данияра\./); assert.match(resumed.text(), /Ошибок: 2/);
    assert.match(resumed.text(), /Члены \(Личные\)/, 'the list of people is open');
  } finally { resumed.done(); }
  const quiz = setup({ missions: 7 });
  try {
    await quiz.settle();
    await quiz.press('Перейти к проверке');
    assert.match(quiz.text(), /Проверка · 1 из 5/);
  } finally { quiz.done(); }
  const finished = setup({ completed: true, stats: { errors: 1, hints: 0, log: { m1: 1 } } });
  try {
    await finished.settle();
    assert.match(finished.text(), /Тренажёр завершён!/);
    assert.equal(finished.server.calls.length, 1, 'only opened');
    assert.equal(nodes(finished.tree, (n) => n.type?.name === 'MaterialButton').length, 1);
  } finally { finished.done(); }
});

test('the trainer keeps the author’s colours and its material is a reading page', () => {
  const css = read('frontend/features/member/CabinetTrainer.module.css');
  for (const colour of ['--navy:#101828', '--orange:#FF8A1F', '--task:#B5473F', 'background:#E3F6E8', 'background:#3FA45B']) assert.ok(css.includes(colour), colour);
  assert.match(css, /\.mbar \{ position:sticky; bottom:0;/, 'the task stays at the bottom of the game window');
  assert.match(css, /\.tbl \{ width:640px; min-width:640px;/, 'the table is always wider than the 420px game');
  for (const file of ['FreeMembershipGame.tsx', 'CabinetTrainer.tsx']) assert.doesNotMatch(read('frontend/features/member/' + file), /location\.reload|postMessage|onTrainerComplete/, 'the file’s own page hooks are gone');
  const material = load('frontend/features/member/GameMaterial.tsx');
  const html = renderToStaticMarkup(React.createElement(material.FreeMembershipMaterial, { onBack() {} })).replace(/<[^>]+>/g, ' ');
  assert.match(html, /Личный месяц/); assert.match(html, /Правильно: \$450/); assert.match(html, /Правильно: а\) до \$100 твоего взноса отменяется/);
  assert.match(html, /К результату/);
  assert.doesNotMatch(html, /&lt;b&gt;/);
});
