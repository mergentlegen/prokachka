const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./helpers/load-ts.cjs');
const { setupTrainer, task } = require('./helpers/cabinet-trainer.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const program = '55555555-5555-4555-8555-555555555555';
const setup = (start) => setupTrainer({ data: 'shared/domain/marketing-director.ts', trainer: 'MARKETING_DIRECTOR_TRAINER', game: 'frontend/features/member/MarketingDirectorGame.tsx', screens: 'marketingDirectorCabinet' }, start);

test('«Путь к Маркетинг директору»: the trainer, the game list and the database agree on answers, miles and texts', () => {
  const game = load('shared/domain/marketing-director.ts');
  const { trainerAskKeys } = load('shared/domain/cabinet-trainer.ts');
  const sql = read('supabase/20261119-marketing-director.sql');
  const trainer = game.MARKETING_DIRECTOR_TRAINER;
  assert.equal(trainer.missions.length, 6);
  assert.equal(trainer.quiz.length, 4);
  assert.equal(trainer.reward, 2, 'two miles, as in the author file');
  const spec = JSON.parse(sql.match(/when 'marketing-director' then '(\{[^']+\})'::jsonb/)[1]);
  assert.deepEqual(spec, { steps: 6, reward: 2, answers: trainer.quiz.map((question) => question.right) });
  const keys = Object.fromEntries([...sql.match(/select case p_mission (.+?) else null end;/)[1].matchAll(/when (\d) then (\d)/g)].map((match) => [match[1], Number(match[2])]));
  assert.deepEqual(keys, Object.fromEntries(Object.entries(trainerAskKeys(trainer)).map(([mission, right]) => [mission, right])));
  assert.match(sql, /'\^\(m\[1-6\]\|q\[1-4\]\)\$'/, 'the database keeps mistakes of six missions and four questions');
  for (const mission of trainer.missions) {
    if (mission.ask) assert.ok(mission.ask.right < mission.ask.opts.length, mission.ask.q);
    if (mission.stepText) assert.equal(mission.stepText.length, mission.seq.length, mission.text);
    for (const [spot, effect] of Object.entries(trainer.effects)) assert.ok(effect.view || effect.menu, spot);
  }
  for (const question of trainer.quiz) assert.ok(question.right < question.opts.length, question.q);
  // The step a mentor adds says the same as the game list; the earlier games stay as they were.
  assert.ok(sql.includes(`game_title := '${trainer.title}';`));
  assert.ok(sql.includes(`game_text := '${trainer.description}';`));
  const free = load('shared/domain/free-membership.ts').FREE_MEMBERSHIP_TRAINER;
  assert.ok(sql.includes(`game_text := '${free.description}';`));
  assert.match(sql, /when 'free-membership' then '\{"steps":7,"reward":2,"answers":\[1,1,1,1,0\]\}'::jsonb/);
  assert.match(sql, /when 'captain-cruise' then '\{"steps":1,"reward":10,"answers":\[\]\}'::jsonb/, 'the other games keep their rewards');
  assert.match(sql, /'safety-watch','free-membership','marketing-director'\)\);/, 'the task kind is allowed');
  for (const kind of ['first-year', 'safety-watch', 'free-membership', 'marketing-director']) assert.ok(sql.includes(`p_kind = '${kind}' then`), kind);
  assert.ok(!read('supabase/20261118-free-membership.sql').includes('marketing-director'), 'the applied migration is untouched');
  const listed = load('shared/domain/program-games.ts').programGame('marketing-director');
  assert.deepEqual([listed.title, listed.reward, listed.minutes, listed.icon], ['Путь к Маркетинг директору', 2, 5, '🏅']);
  assert.equal(load('shared/domain/types.ts').isTaskInteractiveKind('marketing-director'), true);
  assert.match(read('supabase/bootstrap.sql'), /\\ir 20261119-marketing-director\.sql\s*$/);
  assert.match(read('.github/workflows/check.yml'), /20261119-marketing-director\.sql\n\s+psql -X -v ON_ERROR_STOP=1 -f tests\/marketing-director\.sql/);
});

test('«Путь к Маркетинг директору»: mistakes read back as mission lines; the texts speak to everyone', () => {
  const { trainerErrorLabel } = load('shared/domain/cabinet-trainer.ts');
  const { MARKETING_DIRECTOR_TRAINER } = load('shared/domain/marketing-director.ts');
  assert.equal(trainerErrorLabel(MARKETING_DIRECTOR_TRAINER, 'm2'), 'Миссия 2: Найди раздел, где виден твой путь к рангу Маркетинг директор.');
  assert.equal(trainerErrorLabel(MARKETING_DIRECTOR_TRAINER, 'q4'), 'Итоговая проверка: Где смотреть свой путь к рангу МД?');
  for (const key of ['m7', 'q5', 'm0']) assert.equal(trainerErrorLabel(MARKETING_DIRECTOR_TRAINER, key), null, key);
  const source = read('shared/domain/marketing-director.ts');
  assert.doesNotMatch(source, /Нашёл|пролистал|ты набрал|Ты открыл/);
  assert.match(source, /ok: "Есть!"/); assert.match(source, /Верно — \$300 из \$600!/); assert.match(source, /Верно — \$1,200 из \$3,000!/);
  assert.match(source, /Это уже слишком далеко\. Нужный блок — чуть выше\./);
});

test('«Путь к Маркетинг директору» requests are checked against its own six missions and four questions', async () => {
  const calls = [];
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'm', role: 'member', teamId: 'team' }) },
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (...args) => { calls.push(args); return { data: { step: 1, completed: false }, error: null }; } }) },
  });
  const post = (body) => controller.postReadyProgramAttempt(new Request('http://localhost/api/ready-programs/' + task + '/attempt', { method: 'POST', body: JSON.stringify(body) }), task);
  for (const body of [
    { operation: 'cheat' }, { operation: 'save', step: 7 }, { operation: 'save', step: 4, payload: { answer: 3 } },
    { operation: 'complete', payload: { answers: [0, 1, 1, 1, 0] } }, { operation: 'save', step: 1, payload: { log: { m7: 1 } } }, { operation: 'save', step: 1, payload: { log: { q5: 1 } } },
  ]) assert.equal((await post({ action: 'marketing-director', ...body })).status, 400, JSON.stringify(body));
  // The other trainer keeps its own limits.
  assert.equal((await post({ action: 'free-membership', operation: 'save', step: 7, payload: { answer: 1, log: { m7: 1, q5: 1 } } })).status, 200);
  assert.equal((await post({ action: 'marketing-director', operation: 'save', step: 4, payload: { answer: 1, errors: 2, log: { m2: 1, m4: 1 } } })).status, 200);
  assert.deepEqual(calls.map(([name, args]) => [name, args.p_step]), [['app_free_membership', 7], ['app_marketing_director', 4]]);
  assert.deepEqual(calls[1][1], { p_user_id: 'm', p_task_id: task, p_action: 'save', p_step: 4, p_payload: { answer: 1, errors: 2, log: { m2: 1, m4: 1 } } });
});

test('a mentor can put «Путь к Маркетинг директору» into a program', async () => {
  const rpc = [];
  const controller = load('backend/controllers/program-steps.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'a', role: 'admin', teamId: 'team', name: 'Асель' }) },
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (name, args) => { rpc.push([name, args]); return { data: { data: { id: task }, reopened: 0 }, error: null }; } }) },
    '@/backend/services/audit-log.service': { auditRecord: async () => ({ teamId: 'team' }), recordAudit: async (_user, entry) => { rpc.push(['audit', entry.targetLabel]); } },
  });
  const req = new Request('http://localhost/api/programs/' + program + '/games', { method: 'POST', body: JSON.stringify({ kind: 'marketing-director' }) });
  assert.equal((await controller.addProgramGame(req, program)).status, 201);
  assert.deepEqual(rpc, [['app_program_add_game', { p_actor: 'a', p_program: program, p_kind: 'marketing-director' }], ['audit', 'Игра «Путь к Маркетинг директору»']]);
});

test('the trainer plays through the menu chain to the miles, with hints, mistakes and the step back in the check', async () => {
  const game = setup();
  const bar = () => game.find((n) => n.props?.className === 'mtext')[0];
  try {
    await game.settle();
    assert.match(game.text(), /Путь к Маркетинг директору/); assert.match(game.text(), /Шпаргалка: как это написано в кабинете/);
    await game.press('Начать тренажёр');
    assert.match(game.text(), /Миссия 1 из 6/);
    await game.press('Понятно, ищу!');
    await game.tap('timerPers');
    assert.match(game.text(), /Это твой личный месяц\. Календарный — тот, где написано «До конца месяца»\./); assert.match(game.text(), /Ошибок: 1/);
    await game.tap('timerCal');
    assert.match(game.text(), /✅ Верно! Это календарный месяц/);
    await game.press('Дальше');
    assert.deepEqual(game.server.calls.at(-1), ['save', 1, { errors: 1, hints: 0, log: { m1: 1 } }]);

    // Mission 2: four taps in a row; the bar shows each one, wrong places explain, the open menu forgives empty taps.
    assert.match(game.text(), /Найди раздел, где виден твой путь к рангу Маркетинг директор\./);
    await game.press('Понятно, ищу!');
    assert.match(game.text(), /🎯 Открой меню ☰ в левом верхнем углу\./);
    await game.tap('direct');
    assert.match(game.text(), /Это безоплатное членство\. Путь к рангу — в меню ☰\./);
    await game.tap('burger');
    assert.equal(game.find((n) => n.props?.['data-no-miss'] !== undefined).length, 1, 'the menu is open');
    assert.match(label(bar()), /Нажми «Платежи»\./); assert.doesNotMatch(game.text(), /✅/, 'no window between the taps');
    assert.equal(game.spot('mComp').length, 0, '«Платежи» is still folded');
    await game.tap(null, { menu: true });
    assert.match(game.text(), /Ошибок: 2/, 'an empty spot of the menu is not a mistake');
    await game.tap('mOther');
    assert.match(game.text(), /Путь к рангу — в разделе «Платежи»\. Он внизу меню\./); assert.match(game.text(), /Ошибок: 3/);
    await game.press('💡 Подсказка');
    assert.ok(game.spot('mPay')[0].props.className.includes('pulse'), '«Платежи» lights up');
    await game.tap('mPay');
    assert.match(label(bar()), /Выбери «Компенсация»\./);
    await game.tap('mWallet');
    assert.match(game.text(), /Кошелёк — это твои деньги/);
    await game.tap('mComp');
    assert.equal(game.find((n) => n.props?.['data-no-miss'] !== undefined).length, 0, 'the menu closes');
    assert.match(game.text(), /Твои бонусы и доходы/); assert.match(label(bar()), /Пролистай вниз и нажми «Командный лидерский бонус»\./);
    await game.tap('compOther');
    assert.match(game.text(), /Это другой бонус/);
    await game.tap('compTLB');
    assert.match(game.text(), /✅ Ты на месте!/); assert.match(game.text(), /Меню → Платежи → Компенсация → Командный лидерский бонус/);
    assert.match(game.text(), /Маркетинг директор бонус/, 'the bonus page is open');
    await game.press('Дальше');
    assert.deepEqual(game.server.calls.at(-1), ['save', 2, { errors: 5, hints: 1, log: { m1: 1, m2: 4 } }]);

    // Missions 3–6 on the bonus page, three of them with a question.
    await game.press('Понятно, ищу!'); await game.tap('breakdown');
    assert.match(game.text(), /Это уже слишком далеко\. Нужный блок — чуть выше\./);
    await game.tap('mdBlock'); assert.match(game.text(), /✅ Есть!/); await game.press('Дальше');
    await game.press('Понятно, ищу!'); await game.tap('mdActivation');
    assert.match(game.text(), /✅ Верно — \$300 из \$600!/);
    await game.press('$600'); await game.flush();
    assert.match(game.text(), /Нужно \$600, набрано \$300/, 'the explanation stays');
    await game.press('$300'); await game.press('Дальше');
    assert.deepEqual(game.server.calls.at(-1).slice(0, 2), ['save', 4]); assert.equal(game.server.calls.at(-1)[2].answer, 1);
    await game.press('Понятно, ищу!'); await game.tap('mdTurnover'); await game.press('$1,800'); await game.press('Дальше');
    await game.press('Понятно, ищу!'); await game.tap('mdTurnover');
    assert.match(game.text(), /Тепло! Строка прямо внутри этого блока, внизу\./);
    await game.tap('branchMax'); await game.press('$1,200'); await game.press('Дальше');
    assert.deepEqual(game.server.calls.filter(([operation]) => operation === 'save').map(([, step]) => step), [1, 2, 3, 4, 5, 6]);

    // The check: a mistake takes one question back.
    assert.match(game.text(), /Проверка · 1 из 4/);
    await game.press(game.quiz[0].opts[0]); await game.flush();
    await game.press(game.quiz[1].opts[2]);
    assert.match(game.text(), /Неверно\. Возвращаемся на шаг назад/);
    await game.flush();
    assert.match(game.text(), /Проверка · 1 из 4/);
    for (const question of game.quiz) { await game.press(question.opts[question.right]); await game.flush(); }
    assert.match(game.text(), /Твои итоги/);
    assert.match(game.text(), /Миссия 2: Найди раздел, где виден твой путь к рангу Маркетинг директор\. — ошибок: 4/);
    assert.match(game.text(), /Итоговая проверка: Сколько условий у ранга МД\? — ошибок: 1/);
    assert.ok(game.find((n) => n.type?.name === 'Bold' && n.props.text.includes('Командный лидерский бонус → блок «Маркетинг директор бонус»')).length, '«Запомни главное» of this trainer');
    await game.press('Да, понятно');
    assert.deepEqual(game.server.calls.at(-1)[2], { answers: [0, 1, 1, 1], errors: 9, hints: 1, log: { m1: 1, m2: 4, m3: 1, m4: 1, m6: 1, q2: 1 } });
    assert.equal(game.received.length, 1); assert.equal(game.received[0].points, 2);
    assert.match(game.text(), /Тренажёр завершён!/); assert.match(game.text(), /\+2/); assert.match(game.text(), /свой путь к рангу Маркетинг директор/);
    assert.equal(game.find((n) => n.type?.name === 'MaterialButton').length, 1, 'the material button is there');
    const sent = game.server.calls.length;
    await game.press('↻ Пройти ещё раз'); await game.press('Понятно, ищу!'); await game.tap('timerCal'); await game.press('Дальше');
    // The menu chain starts from its first tap again.
    await game.press('Понятно, ищу!');
    assert.match(label(bar()), /Открой меню ☰ в левом верхнем углу\./); assert.match(game.text(), /Добро пожаловать/);
    await game.tap('burger'); assert.match(label(bar()), /Нажми «Платежи»\./);
    assert.equal(game.server.calls.length, sent, 'practice sends nothing');
  } finally { game.done(); }
});

test('the trainer continues where it stopped: the menu chain starts again from the main page', async () => {
  const chain = setup({ missions: 1 });
  try {
    await chain.settle();
    assert.match(chain.text(), /Пройдено миссий: 1 из 6/);
    await chain.press('Продолжить с миссии 2'); await chain.press('Понятно, ищу!');
    assert.match(chain.text(), /Добро пожаловать/); assert.equal(chain.find((n) => n.props?.['data-no-miss'] !== undefined).length, 0);
    await chain.tap('burger'); await chain.tap('mPay');
    // A wrong place mid-chain is a mistake but keeps the reached tap.
    await chain.tap('mWallet');
    assert.match(chain.text(), /Кошелёк — это твои деньги/); assert.equal(chain.spot('mComp').length, 1, 'the menu stays open');
  } finally { chain.done(); }
  const resumed = setup({ missions: 3, stats: { errors: 2, hints: 0, log: { m2: 2 } } });
  try {
    await resumed.settle();
    await resumed.press('Продолжить с миссии 4');
    assert.match(resumed.text(), /Миссия 4 из 6/); assert.match(resumed.text(), /Ошибок: 2/); assert.match(resumed.text(), /Маркетинг директор бонус/);
  } finally { resumed.done(); }
  const finished = setup({ completed: true });
  try {
    await finished.settle();
    assert.match(finished.text(), /Тренажёр завершён!/);
    assert.equal(finished.server.calls.length, 1, 'only opened');
  } finally { finished.done(); }
});

test('the menu covers the cabinet, not the task bar, and the material is a reading page', () => {
  const css = read('frontend/features/member/CabinetTrainer.module.css');
  assert.match(css, /\.drawer \{ position:absolute; inset:0; z-index:3;/, 'the menu stays inside the cabinet');
  assert.match(css, /\.mbar \{ position:sticky; bottom:0; z-index:4;/, 'the task bar is above the menu');
  assert.doesNotMatch(read('frontend/features/member/MarketingDirectorGame.tsx'), /location\.reload|position:\s*"?fixed/);
  const material = load('frontend/features/member/GameMaterial.tsx');
  const html = renderToStaticMarkup(React.createElement(material.MarketingDirectorMaterial, { onBack() {} })).replace(/<[^>]+>/g, ' ');
  assert.match(html, /Где это в кабинете: 6 миссий/); assert.match(html, /Правильно: \$1,800/); assert.match(html, /Новый оборот — \$600/);
  assert.match(html, /Правильно: б\) до \$1,200/); assert.doesNotMatch(html, /&lt;b&gt;/);
  const archive = read('frontend/features/member/TaskCard.tsx');
  assert.match(archive, /"marketing-director": MarketingDirectorMaterial/);
  assert.match(archive, /task\.interactiveKind === "marketing-director" && <MarketingDirectorGame/);
});

function label(tree) { return Array.isArray(tree) ? tree.map(label).join('') : tree && typeof tree === 'object' ? label(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree); }
