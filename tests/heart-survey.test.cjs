const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const harnessFactory = require('./helpers/hook-harness.cjs');

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(item => nodes(item, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}

test('survey request validates choices and takes its questions from the server', async () => {
  const calls = []; let scheduled = 0;
  const service = load('backend/services/heart-survey.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: { completed: true } }; } }) },
  });
  const controller = load('backend/controllers/heart-survey.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/heart-survey.service': service,
    '@/backend/services/telegram-notifications.service': { scheduleTelegramDelivery: () => scheduled++ },
  });
  const id = 'd600fb59-ed65-4ffb-a8b0-0bfeaa3ecba5';
  const req = input => new Request('http://localhost', { method: 'POST', body: JSON.stringify(input) });
  assert.equal((await controller.postHeartSurvey(req({ action: 'answer', answer: 5, questionIndex: 0 }), id)).status, 400);
  assert.equal((await controller.postHeartSurvey(req({ action: 'answer', answer: 0 }), id)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await controller.postHeartSurvey(req({ action: 'answer', answer: 4, questionIndex: 4, definition: { title: 'Injected' } }), id)).status, 200);
  assert.equal(calls[0].args.p_definition.title, 'Куда зовёт твоё сердце?');
  assert.equal(calls[0].args.p_answer, 4); assert.equal(scheduled, 1);
  assert.equal(load('frontend/shared/api/client.ts').mapSubmission({ interactive_completed: false }).interactiveCompleted, false);
});

test('survey choices remain editable until Next; saved answer advances and publishes the immediate reward', async () => {
  const harness = harnessFactory(); const definition = load('shared/domain/heart-survey.ts').HEART_SURVEY;
  let progress = 0; const calls = [];
  let saved = { definition, questionIndex: 0, earnedPoints: 0, answers: [], completed: false, delivery: { total: 2, sent: 0, waiting: 1 } };
  const { HeartSurvey } = load('frontend/features/member/HeartSurvey.tsx', {
    react: { ...harness.react, useId: () => 'survey' },
    '@/frontend/shared/api/heart-survey-client': { heartSurveyRequest: async (_task, answer, questionIndex) => {
      if (answer !== undefined) { calls.push({ answer, questionIndex }); saved = { ...saved, answers: [...saved.answers, answer], earnedPoints: saved.earnedPoints + 1, questionIndex: saved.questionIndex + 1, completed: saved.questionIndex === 4 }; }
      return saved;
    } },
  });
  let tree = harness.mount(HeartSurvey, { taskId: 'survey', onProgress: () => progress++ });
  const press = async predicate => { const b = nodes(tree, n => n.type === 'button' && predicate(n))[0]; assert.ok(b); assert.ok(!b.props.disabled); b.props.onClick(); tree = await harness.settle(); };
  try {
    tree = await harness.settle();
    await press(n => n.props.children === 'Начать путешествие →');
    await press(n => n.props['aria-pressed'] !== undefined && n.props.children[1].props.children === definition.questions[0].options[0].text);
    await press(n => n.props['aria-pressed'] !== undefined && n.props.children[1].props.children === definition.questions[0].options[4].text);
    assert.equal(calls.length, 0);
    await press(n => n.props.children === 'Далее →');
    assert.deepEqual(calls, [{ answer: 4, questionIndex: 0 }]); assert.equal(progress, 1);
    assert.ok(nodes(tree, n => n.type === 'h4' && n.props.children === definition.questions[1].title).length);
    harness.unmount();
    tree = harness.mount(HeartSurvey, { taskId: 'survey', onProgress: () => progress++ }); tree = await harness.settle();
    assert.ok(nodes(tree, n => n.type === 'h4' && n.props.children === definition.questions[1].title).length);
    assert.equal(progress, 1);
  } finally { harness.unmount(); }
});

test('Telegram survey jobs deliver independently, retry failures and cancel revoked access', async () => {
  const patches = [], requests = [];
  const jobs = ['good', 'fail', 'revoked'].map(id => ({ id, recipient_id: id, submission_id: 'survey', kind: 'survey', attempts: 1, lock_token: 'lock' }));
  const db = {
    rpc: async (name, args) => name === 'tg_claim_notification' ? { data: jobs.length ? [jobs.shift()] : [] } : { data: args.p_recipient !== 'revoked' },
    from: table => { let id; return { select() { return this; }, eq(key, value) { if (key === 'id') id = value; return this; }, maybeSingle: async () => ({ data: table === 'users' ? { id, telegram_id: id, role: 'member', can_review: true } : { answer_text: 'Five saved answers' } }),
      update(patch) { patches.push({ table, patch }); return this; }, then(resolve) { resolve({ error: null }); } }; },
  };
  const original = global.fetch;
  global.fetch = async (_url, init) => { const body = JSON.parse(init.body); requests.push(body); return { ok: body.chat_id !== 'fail', status: body.chat_id === 'fail' ? 400 : 200, json: async () => ({ ok: body.chat_id !== 'fail', description: 'Blocked' }) }; };
  try {
    const service = load('backend/services/telegram-notifications.service.ts', { 'next/server': { after() {} }, '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db }, '@/backend/config/env': { serverEnv: { telegramBotToken: 'fixture' } } });
    const result = await service.deliverTelegramNotifications();
    assert.deepEqual(result, { delivered: 1, failed: 1 }); assert.equal(requests.length, 2);
    assert.ok(patches.some(p => p.patch.delivered_at)); assert.ok(patches.some(p => p.patch.available_at)); assert.ok(patches.some(p => p.patch.cancelled_at));
  } finally { global.fetch = original; }
});
