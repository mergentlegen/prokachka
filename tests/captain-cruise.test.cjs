const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');
const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap(item => nodes(item, predicate)) : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];

test('captain catalog gives 9 training miles plus one screenshot mile and a separate evergreen key', () => {
  const { CAPTAIN_STAGES, CAPTAIN_TRAINING_REWARD, CAPTAIN_CRUISE_REWARD, CRUISE_LINES, captainMessage } = load('shared/domain/captain-cruise.ts');
  assert.equal(CAPTAIN_STAGES.length, 16);
  assert.equal(CAPTAIN_STAGES.reduce((sum, stage) => sum + stage.miles, 0), 9);
  assert.equal(CAPTAIN_TRAINING_REWARD, 9); assert.equal(CAPTAIN_CRUISE_REWARD, 10);
  assert.equal(CRUISE_LINES.length, 15); assert.equal(CRUISE_LINES.filter(line => line[1] === 'river').map(line => line[0]).join(), 'AmaWaterways');
  assert.equal(CAPTAIN_STAGES[2].options[1], '15'); assert.match(CAPTAIN_STAGES[3].explanation, /^Azamara Cruises, Explora Journeys, Oceania Cruises, Seabourn —/);
  const { readyProgramByKey } = load('shared/domain/ready-programs.ts');
  assert.equal(readyProgramByKey('captain-cruise').tasks[0].maxPoints, 10);
  assert.match(readyProgramByKey('captain-cruise').tasks[0].description, /получи 9 миль/);
  assert.equal(readyProgramByKey('captain-cruise').tasks[0].publicationType, 'evergreen');
  const { mapTask } = load('frontend/shared/api/client.ts');
  assert.equal(mapTask({ interactive_kind: 'captain-cruise' }).interactiveKind, 'captain-cruise');
  assert.equal(captainMessage({ direction: 'Европа', line: 'MSC Cruises', who: '2 взрослых', price: '$1000' }), 'Привет! Я прошёл(ла) тренировку «Капитан ищет свой круиз» 🚢\nВыбрал(а) направление: Европа\nКруизная линия: MSC Cruises\nЕдем: 2 взрослых\nЦена за всех: $1000\nСкриншот прикрепляю 📸');
});

test('captain action API takes identity from the session and validates input before the RPC', async () => {
  const id = 'd600fb59-ed65-4ffb-a8b0-0bfeaa3ecba5'; const calls = [];
  const controller = load('backend/controllers/ready-program-attempts.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'actual-member', role: 'member' }) },
    '@/backend/services/captain-cruise.service': { captainCruiseAction: async (...args) => { calls.push(args); return { data: { index: 1 } }; } },
  });
  const send = body => controller.postReadyProgramAttempt(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) }), id);
  for (const body of [{ operation: 'unknown' }, { operation: 'checkpoint', index: -1 }, { operation: 'checkpoint', index: 1.5 }, { operation: 'start', payload: [] }, { operation: 'start', payload: { long: 'x'.repeat(3001) } }]) assert.equal((await send({ action: 'captain', ...body })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await send({ action: 'captain', operation: 'checkpoint', index: 0, payload: { answer: 0 }, userId: 'forged' })).status, 200);
  assert.deepEqual(calls[0], ['actual-member', id, 'checkpoint', 0, { answer: 0 }]);
});

test('captain Telegram preparation saves details first and never awards on navigation', async () => {
  const calls = [];
  const service = load('backend/services/captain-cruise.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: { trainingDone: true } }; } }) },
    './telegram-submission.service': { prepareTelegramSubmission: async (...args) => { calls.push(args); return { url: 'https://t.me/fixture?start=captain_fixture' }; } },
  });
  const payload = { details: { direction: 'Европа', line: 'MSC', who: '2 взрослых', price: '$1000' } };
  await service.captainCruiseAction('member', 'task', 'telegram-link', undefined, payload);
  assert.equal(calls[0].name, 'app_captain_cruise'); assert.equal(calls[0].args.p_action, 'save-details'); assert.deepEqual(calls[0].args.p_payload, payload);
  assert.deepEqual(calls[1], ['member', 'task', 'captain-screenshot']);
});

const label = tree => Array.isArray(tree) ? tree.map(label).join('') : tree && typeof tree === 'object' ? label(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
const classes = n => String(n.props.className || '').split(/\s+/);

test('captain port keeps the cabinet screens, inline hints, practice gates, local retry and automatic 9-mile completion', async () => {
  const harness = hookHarness(), react = { ...harness.react, useId: () => 'captain' };
  const { CAPTAIN_STAGES } = load('shared/domain/captain-cruise.ts');
  const keys = [0,2,1,1,1,2,-1,-1,1,1,1,2,1,1,1,0]; let retries = 0, finishes = 0, received = 0, actions = 0;
  let state = { index: 0, failed: false, trainingDone: false, screenshotSent: false, trainingPoints: 0, earnedPoints: 0, direction: '' };
  const api = { captainAction: async (_id, action, index, payload) => {
    actions++;
    if (action === 'retry') { retries++; state = { ...state, failed: false }; }
    if (action === 'checkpoint') {
      assert.equal(index, state.index); assert.equal(state.failed, false);
      if (index === 7) assert.equal(payload.readKeys.length, 6);
      if (index === 10) assert.deepEqual([...payload.readCabins].sort(), [0,1,2,3]);
      if (index === 12) assert.deepEqual(payload.guests, [2,2,0]);
      const correct = keys[index] < 0 || payload.answer === keys[index];
      state = { ...state, failed: !correct, lastAnswer: payload.answer };
      if (correct) state = { ...state, index: index + 1, trainingPoints: state.trainingPoints + CAPTAIN_STAGES[index].miles, direction: payload.direction || state.direction, guests: payload.guests || state.guests };
    }
    if (action === 'finish') { assert.equal(state.index, 16); assert.equal(state.trainingPoints, 9); finishes++; state = { ...state, trainingDone: true, earnedPoints: 9, submission: { id: 'same-result', points: 9, interactiveCompleted: false } }; }
    return state;
  } };
  const css = { __esModule: true, default: new Proxy({}, { get: (_t, key) => key }) };
  const { CaptainCruiseGame } = load('frontend/features/member/CaptainCruiseGame.tsx', { react, '@/frontend/shared/api/captain-cruise-client': api, './CaptainCruiseGame.module.css': css });
  harness.mount(CaptainCruiseGame, { taskId: 'captain', onCompleted: result => { received++; assert.equal(result.points, 9); } });
  let tree = await harness.settle();
  const press = async predicate => { const button = nodes(tree, n => n.type === 'button' && predicate(n))[0]; assert.ok(button, 'button exists'); assert.equal(Boolean(button.props.disabled), false, label(button)); button.props.onClick(); tree = await harness.settle(); };
  const named = name => press(n => label(n) === name);
  const screen = value => assert.equal(nodes(tree, n => n.props?.['data-captain-screen'])[0].props['data-captain-screen'], value);
  const answer = async index => { await press(n => n.props['aria-pressed'] !== undefined && label(n) === CAPTAIN_STAGES[index].options[keys[index]]); await named('Дальше →'); };
  try {
    assert.match(label(tree), /10 ✈️ миль/); assert.match(label(tree), /✈️ 0 из 10/);
    await named('Начать тренировку'); screen('home'); assert.match(label(tree), /Задание 1\./);
    const before = actions; await press(n => label(n).includes('Забронировать отель')); assert.equal(actions, before); screen('home');
    await press(n => label(n).includes('Забронировать круиз')); screen('search'); assert.equal(state.index, 1); assert.match(label(tree), /\+1 ✈️ миля/);
    await press(n => n.props['aria-pressed'] !== undefined && label(n) === '500');
    assert.equal(retries, 0); assert.equal(state.index, 1);
    assert.match(nodes(tree, n => n.props?.['aria-pressed'] === true)[0].props.className, /bad/);
    assert.equal(nodes(tree, n => n.props?.role === 'alert').length, 1);
    await named('Попробовать ещё раз'); assert.equal(retries, 1);
    await answer(1);
    await named('Поиск'); screen('search'); assert.equal(state.index, 2);
    await press(n => n.props['aria-label'] === 'Круизная линия'); screen('lines');
    assert.equal(nodes(tree, n => n.type === 'button' && classes(n)[0] === 'row').length, 15); assert.match(label(tree), /0 из 15/);
    await press(n => classes(n)[0] === 'row' && label(n).startsWith('AmaWaterways'));
    assert.match(label(tree), /Речные круизы: путешествие по рекам/); assert.match(label(tree), /1 из 15/);
    await named('Я посчитал(а) →'); for (const index of [2,3,4]) await answer(index);
    await press(n => n.props['aria-pressed'] !== undefined && label(n) === 'Disney Cruise Line'); assert.match(label(tree), /\+2 ✈️ мили/); await named('Дальше →');
    screen('search'); assert.equal(state.trainingPoints, 3);
    await press(n => n.props['aria-label'] === 'Круизное направление'); screen('dest');
    assert.equal(nodes(tree, n => n.type === 'button' && n.props.className === 'row').length, 17);
    await named('Европа'); await named('Поиск'); screen('card');
    await press(n => n.props.className === 'ttl'); assert.equal(state.index, 7); screen('card');
    for (let i = 0; i < 6; i++) await press(n => (classes(n)[0] === 'info' || classes(n)[0] === 'price') && !classes(n).includes('read'));
    assert.equal(state.index, 8); assert.equal(finishes, 0); assert.match(label(tree), /Карточка прочитана/);
    await press(n => n.props.className === 'ttl'); await answer(8); await answer(9); screen('cruise');
    await named('Book Cruise'); screen('cruise');
    for (let i = 0; i < 4; i++) await press(n => classes(n)[0] === 'cat' && label(n).includes(['Внутренняя','С видом на море','Балкон','Сюита'][i]));
    await new Promise(resolve => setTimeout(resolve, 750)); tree = await harness.settle();
    await answer(10); await named('Проверь себя'); await answer(11);
    await named('Book Cruise'); screen('guests');
    await press(n => n.props['aria-label'] === 'Добавить: Дети и подростки'); await press(n => n.props['aria-label'] === 'Добавить: Дети и подростки');
    await named('Продолжить →'); await answer(12); await answer(13); screen('cabin');
    await answer(14); assert.equal(finishes, 0);
    await press(n => label(n).includes('Deluxe Ocean View')); screen('twist');
    assert.equal(finishes, 1); assert.equal(received, 1); assert.equal(state.earnedPoints, 9);
    assert.equal(nodes(tree, n => n.type === 'button' && label(n) === '📤 Отправить наставнику · +1 ✈️')[0].props.disabled, true);
    assert.match(label(tree), /Это была тренировка/); assert.match(label(tree), /15 круизных линий/); assert.match(label(tree), /Задание 9\./);
  } finally { harness.unmount(); }
});

test('captain resumes passed practice and failed question without discarding server progress', async () => {
  for (const saved of [
    { index: 8, trainingPoints: 4, direction: 'Европа' },
    { index: 11, trainingPoints: 5, direction: 'Европа' },
    { index: 14, trainingPoints: 7, guests: [2,2,0] },
    { index: 10, trainingPoints: 5, failed: true, lastAnswer: 0 },
    { index: 16, trainingPoints: 9, trainingDone: true, earnedPoints: 9 },
  ]) {
    const harness = hookHarness();
    const css = { __esModule:true, default:new Proxy({}, { get:(_t,key) => key }) };
    const { CaptainCruiseGame } = load('frontend/features/member/CaptainCruiseGame.tsx', { react:{ ...harness.react, useId:()=>'resume' }, '@/frontend/shared/api/captain-cruise-client':{ captainAction:async()=>saved }, './CaptainCruiseGame.module.css':css });
    try {
      harness.mount(CaptainCruiseGame, { taskId:'captain' }); const tree = await harness.settle();
      if (saved.index === 8) assert.equal(nodes(tree, n=>n.type==='button' && classes(n).includes('read')).length, 6);
      if (saved.index === 11) assert.equal(nodes(tree, n=>n.type==='button' && classes(n).includes('catRead')).length, 4);
      if (saved.index === 14) assert.match(label(tree), /Сколько будет стоить, если взять ещё 2 детей/);
      if (saved.failed) { assert.match(nodes(tree,n=>n.props?.['aria-pressed']===true)[0].props.className,/bad/); assert.equal(nodes(tree, n=>n.type==='button' && classes(n).includes('catRead')).length, 4); }
      if (saved.trainingDone) assert.match(label(tree),/9 ✈️ миль/);
    } finally { harness.unmount(); }
  }
});
