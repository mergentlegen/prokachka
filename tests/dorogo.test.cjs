// «Тренажёр «Дорого»» (database rules: tests/dorogo.sql). The screen is the shared ObjectionTrainer, like «Я подумаю».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-ts.cjs');
const { setupTrainer, nodes, label, taskId } = require('./helpers/objection-trainer-harness.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const KEYS = { answers: [1, 2, 1, 2, 1], sort: [true, false, true, false, true, false] };
const setup = (start) => setupTrainer(load('shared/domain/dorogo.ts').DOROGO_TRAINER, KEYS, start);

test('«Дорого»: the rounds, the game list and the database agree; texts speak to everyone', () => {
  const data = load('shared/domain/dorogo.ts');
  const trainer = data.DOROGO_TRAINER;
  assert.deepEqual(trainer.rounds.map((round) => round.kind), ['chat', 'chat', 'chat', 'chat', 'chat', 'sort']);
  assert.equal(trainer.sortStep, 5);
  for (const round of trainer.rounds.slice(0, 5)) assert.equal(round.options.length, 4, round.title);
  assert.equal(trainer.rounds[5].phrases.length, 6);
  for (const phrase of trainer.rounds[5].phrases) assert.doesNotMatch(phrase.comment, /^(Помогает|Вредит)/, 'the screen adds «Помогает:» / «Вредит:» itself');
  const sql = read('supabase/20261127-dorogo.sql');
  const spec = JSON.parse(sql.match(/when 'dorogo' then '(\{[^']+\})'::jsonb/)[1]);
  assert.deepEqual(spec, { steps: 6, reward: data.DOROGO_REWARD, ...KEYS });
  assert.ok(sql.includes(`game_title := '${data.DOROGO_TITLE}';`));
  assert.ok(sql.includes(`game_text := '${data.DOROGO_DESCRIPTION}';`));
  // The functions are redefined whole: every earlier game stays in them.
  for (const kind of ['first-year', 'safety-watch', 'free-membership', 'marketing-director', 'final-voyage-1', 'podumayu']) assert.ok(sql.includes(`p_kind = '${kind}' then`), kind);
  for (const kind of ['dream-plan', 'starter-rules', 'company-voyage', 'captain-cruise', 'count-your-dream', 'dream-route', 'first-year', 'safety-watch', 'free-membership', 'marketing-director', 'final-voyage-1', 'podumayu'])
    assert.ok(sql.includes(`when '${kind}' then`), 'the reward list keeps ' + kind);
  assert.match(sql, /'final-voyage-1','podumayu','dorogo'\)\);/, 'the task kind is allowed');
  assert.equal((sql.match(/'dream-route','final-voyage-1','podumayu','dorogo'\)/g) || []).length, 2, 'the voice works for the trainer');
  assert.doesNotMatch(sql, /app_program_game_error\(p_user_id uuid|create or replace function public\.tg_target_error/, 'the program queue functions of 20261126 are left alone');
  const listed = load('shared/domain/program-games.ts').programGame('dorogo');
  assert.deepEqual([listed.title, listed.reward, listed.minutes, listed.icon], ['Тренажёр «Дорого»', 1, 8, '💰']);
  assert.equal(load('shared/domain/types.ts').isTaskInteractiveKind('dorogo'), true);
  assert.match(read('supabase/bootstrap.sql'), /\\ir 20261126-program-queue\.sql\r?\n\\ir 20261127-dorogo\.sql\r?\n/);
  assert.match(read('.github/workflows/check.yml'), /tests\/program-queue\.sql\r?\n\s+psql -X -v ON_ERROR_STOP=1 -f supabase\/20261127-dorogo\.sql\r?\n\s+psql -X -v ON_ERROR_STOP=1 -f tests\/dorogo\.sql/);
  assert.match(read('frontend/features/member/TaskCard.tsx'), /interactiveKind === "dorogo" && <ObjectionTrainer trainer=\{DOROGO_TRAINER\} taskId=\{task\.id\} onCompleted=\{onInteractiveComplete\} \/>/);
  const text = read('shared/domain/dorogo.ts');
  assert.doesNotMatch(text, /не уверен[^а-я(]|[Пп]роверил|Узнал причину|Не выдумал|ты уже получил/, 'texts are not written to a man only');
  assert.doesNotMatch(text, /t\.me\/|INCRUISES_PROKACHKA_BOT/, 'the voice goes through the site, not a bare bot link');
  assert.doesNotMatch(text + read('frontend/features/member/ObjectionTrainer.tsx'), /Пройти ещё раз/, 'no replay without a mile');
  assert.match(text, /Не знать — нормально\. Выдумывать — нельзя\./);
});

test('«Дорого»: the server action takes the current round, an option 0–3 or a phrase 0–5 with true/false', async () => {
  const calls = [];
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/objection-trainer.service': { objectionTrainerAction: async (kind, ...args) => {
      calls.push([kind, ...args]); return args[2] === 'complete' ? { validationError: 'Сначала пройди все 6 раундов.' } : { data: { step: 1 } };
    } },
  });
  const post = (body) => controller.postReadyProgramAttempt(new Request(`http://localhost/api/ready-programs/${taskId}/attempt`, { method: 'POST', body: JSON.stringify({ action: 'dorogo', ...body }) }), taskId);
  for (const body of [{ operation: 'jump' }, { operation: 'answer', step: 6, payload: { answer: 0 } }, { operation: 'answer', step: 0, payload: { answer: 4 } },
    { operation: 'mark', step: 5, payload: { item: 6, good: true } }, { operation: 'mark', step: 5, payload: { item: 0, good: 'yes' } }, { operation: 'answer', step: 0, payload: [1] }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
  assert.equal((await post({ operation: 'answer', step: 4, payload: { answer: 1 } })).status, 200);
  assert.equal((await post({ operation: 'mark', step: 5, payload: { item: 5, good: false } })).status, 200);
  assert.deepEqual(calls.map((call) => call.slice(0, 6)), [['dorogo', 'member', taskId, 'answer', 4, { answer: 1 }], ['dorogo', 'member', taskId, 'mark', 5, { item: 5, good: false }]]);
  const refused = await post({ operation: 'complete' });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).message, /Сначала пройди все 6 раундов/);
  // «Я подумаю» still has 4 phrases: phrase 4 is refused there before the database.
  const podumayu = await controller.postReadyProgramAttempt(new Request(`http://localhost/api/ready-programs/${taskId}/attempt`, { method: 'POST',
    body: JSON.stringify({ action: 'podumayu', operation: 'mark', step: 3, payload: { item: 4, good: true } }) }), taskId);
  assert.equal(podumayu.status, 400);
});

test('«Дорого»: five dialogues, six phrases, the mile once, the voice and the material', async () => {
  const game = setup();
  try {
    await game.settle();
    assert.match(game.text(), /Тренажёр «Дорого»/);
    assert.match(game.text(), /«Дорого» — не всегда про деньги/);
    assert.match(game.text(), /не видит ценности — «за что я плачу\?»;/);
    assert.match(game.text(), /Наша задача — не уговаривать, а понять, какой это случай\./);
    assert.match(game.text(), /Пройди 6 раундов\./);
    assert.match(game.text(), /✈️ 0\/1/);
    await game.press('Начать тренировку');
    assert.match(game.text(), /Раунд 1 из 6/);
    assert.match(game.text(), /КлиентИнтересно, но дорого\./);
    await game.pick(0);
    assert.match(game.text(), /Не совсем\. Попробуй ещё разТы обесцениваешь его слова/);
    await game.pick(1);
    assert.match(game.text(), /Верно!Ты проверяешь, деньги ли это/);
    await game.pick(2);
    assert.match(game.text(), /Что будет, если сказать такКрасная линия/);
    await game.press('Дальше →');
    for (const [round, right] of [[2, 2], [3, 1], [4, 2], [5, 1]]) {
      assert.match(game.text(), new RegExp(`Раунд ${round} из 6`));
      await game.pick(right); await game.press('Дальше →');
    }
    assert.match(game.text(), /Раунд 6\. Помогает или вредит\?/);
    await game.mark(5, true);
    assert.match(game.text(), /Не совсемВредит: Втягивание в долги запрещено\./);
    await game.mark(5, false);
    assert.match(game.text(), /Верно!Вредит: Втягивание в долги запрещено\./);
    for (const [index, good] of [[0, true], [1, false], [2, true], [3, false]]) await game.mark(index, good);
    assert.equal(game.buttons((n) => label(n) === 'Дальше →').length, 0, '«Дальше» waits for every phrase');
    await game.mark(4, true);
    assert.equal(game.server.calls.filter(([operation]) => operation === 'mark').length, 6);
    await game.press('Дальше →');
    assert.match(game.text(), /Тренажёр пройден 🎉/);
    assert.match(game.text(), /«Дорого» — это вопрос:«Покажи, за что я плачу»\./);
    assert.match(game.text(), /Решить честно: показать ценность, открыть соглашение или договориться вернуться позже\./);
    assert.match(game.text(), /Никогда: кредиты, займы/);
    assert.match(game.text(), /Не знаешь ответа: «Уточню у наставника и вернусь до …»/);
    await game.press('Забрать ✈️ 1 милю');
    assert.deepEqual(game.received, [{ id: 'result', points: 1 }]);
    assert.match(game.text(), /✈️ 1\/1/);
    assert.match(game.text(), /а если я перестану платить, что будет с деньгами\?/);
    assert.match(game.text(), /В голосовом: проверить → узнать причину → не выдумывать: документ или наставник\./);
    await game.press('🎙️ Записать голосовое наставнику');
    assert.equal(game.server.voiceLinks, 1);
    nodes(game.tree, (n) => n.type?.name === 'MaterialButton')[0].props.onClick(); await game.settle();
    const right = nodes(game.tree, (n) => n.type === 'div' && /\bgood\b/.test(n.props.className || '')).map(label);
    assert.equal(right.length, 5, 'each dialogue round shows its right option');
    assert.ok(right[3].startsWith('«Очень правильные вопросы.'));
    assert.match(game.text(), /«Через год сами будете зарабатывать — всё окупится»\.👎 Вредит: Обещание дохода запрещено\./);
    assert.equal(game.server.calls.filter(([operation]) => operation === 'complete').length, 1);
  } finally { game.done(); }
});

test('«Дорого»: the trainer opens where it stopped', async () => {
  const middle = setup({ step: 5, mistakes: 1, marks: { 0: true, 3: true } });
  try {
    await middle.settle();
    assert.match(middle.text(), /Раунд 6 из 6/);
    assert.match(middle.text(), /Верно!Помогает: Проверяешь настоящую причину\./);
    assert.match(middle.text(), /Не совсемВредит: Обещание дохода запрещено\./);
  } finally { middle.done(); }
  const passed = setup({ step: 6, completed: true });
  try { await passed.settle(); assert.match(passed.text(), /✈️ \+1 миля зачислена!/); assert.equal(passed.server.calls.length, 1); } finally { passed.done(); }
});
