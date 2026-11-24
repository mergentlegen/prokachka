// «Тренажёр «Семья против»» (database rules: tests/semya.sql). The screen is the shared ObjectionTrainer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-ts.cjs');
const { setupTrainer, nodes, label, taskId } = require('./helpers/objection-trainer-harness.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const KEYS = { answers: [2, 1, 2, 1, 3], sort: [true, false, true, false, true, false] };
const setup = (start) => setupTrainer(load('shared/domain/semya.ts').SEMYA_TRAINER, KEYS, start);

test('«Семья против»: the rounds, the game list and the database agree; texts speak to everyone', () => {
  const data = load('shared/domain/semya.ts');
  const trainer = data.SEMYA_TRAINER;
  assert.deepEqual(trainer.rounds.map((round) => round.kind), ['chat', 'chat', 'chat', 'chat', 'chat', 'sort']);
  assert.equal(trainer.sortStep, 5);
  for (const round of trainer.rounds.slice(0, 5)) assert.equal(round.options.length, 4, round.title);
  assert.equal(trainer.rounds[5].phrases.length, 6);
  for (const phrase of trainer.rounds[5].phrases) assert.doesNotMatch(phrase.comment, /^(Помогает|Вредит)/, 'the screen adds «Помогает:» / «Вредит:» itself');
  const sql = read('supabase/20261135-semya.sql');
  const spec = JSON.parse(sql.match(/when 'semya' then '(\{[^']+\})'::jsonb/)[1]);
  assert.deepEqual(spec, { steps: 6, reward: data.SEMYA_REWARD, ...KEYS });
  assert.ok(sql.includes(`game_title := '${data.SEMYA_TITLE}';`));
  assert.ok(sql.includes(`game_text := '${data.SEMYA_DESCRIPTION}';`));
  for (const kind of ['first-year', 'safety-watch', 'free-membership', 'marketing-director', 'final-voyage-1', 'podumayu', 'dorogo', 'piramida', 'garantii', 'bally', 'deshevle', 'strah', 'vremya']) assert.ok(sql.includes(`p_kind = '${kind}' then`), kind);
  for (const kind of ['dream-plan', 'starter-rules', 'company-voyage', 'captain-cruise', 'count-your-dream', 'dream-route', 'first-year', 'safety-watch', 'free-membership', 'marketing-director', 'final-voyage-1', 'podumayu', 'dorogo', 'piramida', 'garantii', 'bally', 'deshevle', 'strah', 'vremya'])
    assert.ok(sql.includes(`when '${kind}' then`), 'the reward list keeps ' + kind);
  assert.match(sql, /'strah','vremya','semya'\)\);/, 'the task kind is allowed');
  assert.equal((sql.match(/'dream-route','final-voyage-1','podumayu','dorogo','piramida','garantii','bally','deshevle','strah','vremya','semya'\)/g) || []).length, 2, 'the voice works for the trainer');
  assert.doesNotMatch(sql, /app_program_game_error\(p_user_id uuid|create or replace function public\.tg_target_error|app_participation_rules/, 'functions of other migrations are left alone');
  assert.match(sql, /after 20261134;/);
  const listed = load('shared/domain/program-games.ts').programGame('semya');
  assert.deepEqual([listed.title, listed.reward, listed.minutes, listed.icon], ['Тренажёр «Семья против»', 1, 8, '🏡']);
  assert.equal(load('shared/domain/types.ts').isTaskInteractiveKind('semya'), true);
  assert.match(read('supabase/bootstrap.sql'), /\\ir 20261134-vremya\.sql\r?\n\\ir 20261135-semya\.sql\r?\n/);
  assert.match(read('.github/workflows/check.yml'), /tests\/vremya\.sql\r?\n\s+psql -X -v ON_ERROR_STOP=1 -f supabase\/20261135-semya\.sql\r?\n\s+psql -X -v ON_ERROR_STOP=1 -f tests\/semya\.sql/);
  assert.match(read('frontend/features/member/TaskCard.tsx'), /interactiveKind === "semya" && <ObjectionTrainer trainer=\{SEMYA_TRAINER\} taskId=\{task\.id\} onCompleted=\{onInteractiveComplete\} \/>/);
  const text = read('shared/domain/semya.ts');
  assert.doesNotMatch(text, /ты рассказала|мужа сама|семьи самой|не смог|решать сам |ты уже получил|Уважал|Узнал довод|Предложил встречу|что ответил человек/, 'texts are not written to one gender only');
  assert.doesNotMatch(text, /t\.me\/|INCRUISES_PROKACHKA_BOT|Пройти ещё раз/, 'the voice goes through the site; no replay without a mile');
  assert.match(text, /Главное: не ставь человека против близких — помоги им разобраться вместе\./);
});

test('«Семья против»: the server action takes the current round, an option 0–3 or a phrase 0–5 with true/false', async () => {
  const calls = [];
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/objection-trainer.service': { objectionTrainerAction: async (kind, ...args) => {
      calls.push([kind, ...args]); return args[2] === 'complete' ? { validationError: 'Сначала пройди все 6 раундов.' } : { data: { step: 1 } };
    } },
  });
  const post = (body) => controller.postReadyProgramAttempt(new Request(`http://localhost/api/ready-programs/${taskId}/attempt`, { method: 'POST', body: JSON.stringify({ action: 'semya', ...body }) }), taskId);
  for (const body of [{ operation: 'jump' }, { operation: 'answer', step: 6, payload: { answer: 0 } }, { operation: 'answer', step: 2, payload: { answer: 4 } },
    { operation: 'mark', step: 5, payload: { item: 6, good: true } }, { operation: 'mark', step: 5, payload: { item: 0, good: 'yes' } }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
  assert.equal((await post({ operation: 'answer', step: 4, payload: { answer: 3 } })).status, 200);
  assert.deepEqual(calls.map((call) => call.slice(0, 6)), [['semya', 'member', taskId, 'answer', 4, { answer: 3 }]]);
  const refused = await post({ operation: 'complete' });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).message, /Сначала пройди все 6 раундов/);
});

test('«Семья против»: five dialogues, six phrases, the mile once, the voice and the material', async () => {
  const game = setup();
  try {
    await game.settle();
    assert.match(game.text(), /Тренажёр «Семья против»/);
    assert.match(game.text(), /«Посоветуюсь с мужем» — семья не враг, а союзник/);
    assert.match(game.text(), /деньги общие — без согласия супруга нельзя;/);
    assert.match(game.text(), /Пройди 6 раундов\./);
    await game.press('Начать тренировку');
    assert.match(game.text(), /КлиентМне нужно посоветоваться с мужем/);
    await game.pick(3);
    assert.match(game.text(), /Не совсем\. Попробуй ещё разКрасная линия: ты предлагаешь скрывать от семьи\./);
    await game.pick(2);
    assert.match(game.text(), /Верно!Ты уважаешь семью, снимаешь с человека тяжесть пересказа/);
    await game.press('Дальше →');
    for (const [round, right] of [[2, 1], [3, 2], [4, 1], [5, 3]]) {
      assert.match(game.text(), new RegExp(`Раунд ${round} из 6`));
      await game.pick(right); await game.press('Дальше →');
    }
    assert.match(game.text(), /Раунд 6\. Помогает или вредит\?/);
    for (const [index, good] of [[0, true], [1, false], [2, true], [3, false], [4, true], [5, false]]) await game.mark(index, good);
    assert.match(game.text(), /Верно!Вредит: Обещаешь то, чего не знаешь\./);
    await game.press('Дальше →');
    assert.match(game.text(), /Семья — не враг, а союзник\.Помоги им разобраться вместе\./);
    assert.match(game.text(), /Узнать довод: «Что именно насторожило\?»/);
    assert.match(game.text(), /Никогда: «не говорите мужу»/);
    await game.press('Забрать ✈️ 1 милю');
    assert.deepEqual(game.received, [{ id: 'result', points: 1 }]);
    assert.match(game.text(), /«Муж сказал, что это развод»/);
    assert.match(game.text(), /В голосовом: уважать семью → узнать довод → предложить встречу\./);
    await game.press('🎙️ Записать голосовое наставнику');
    assert.equal(game.server.voiceLinks, 1);
    nodes(game.tree, (n) => n.type?.name === 'MaterialButton')[0].props.onClick(); await game.settle();
    const right = nodes(game.tree, (n) => n.type === 'div' && /\bgood\b/.test(n.props.className || '')).map(label);
    assert.equal(right.length, 5, 'each dialogue round shows its right option');
    assert.ok(right[3].startsWith('«Это важные вопросы'));
    assert.equal(game.server.calls.filter(([operation]) => operation === 'complete').length, 1);
  } finally { game.done(); }
});
