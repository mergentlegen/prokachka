const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

const id = '11111111-1111-4111-8111-111111111111';
const long = 'Ответ '.repeat(200);

test('team lists carry previews of reviewed answers but the full text of waiting ones', () => {
  const { previewAnswer, ANSWER_PREVIEW_LENGTH } = loadTs('backend/services/submissions.service.ts', { '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => null } });
  const pending = previewAnswer({ status: 'pending', answer_text: long });
  assert.equal(pending.answer_text, long, 'the mentor reviews the whole answer');
  assert.equal(pending.answer_truncated, undefined);
  const accepted = previewAnswer({ status: 'accepted', answer_text: long });
  assert.ok(accepted.answer_text.length <= ANSWER_PREVIEW_LENGTH);
  assert.equal(accepted.answer_truncated, true);
  assert.deepEqual(previewAnswer({ status: 'accepted', answer_text: 'Коротко' }), { status: 'accepted', answer_text: 'Коротко' });
});

test('the full answer opens only for those who may review it', async () => {
  let actor = null, answer = { data: { answerText: long } };
  const controller = loadTs('backend/controllers/submissions.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => actor },
    '@/backend/services/submissions.service': { findSubmissionAnswer: async () => answer },
  });
  const req = () => new Request('http://localhost/api/submissions/' + id + '/answer');
  assert.equal((await controller.readSubmissionAnswer(req(), id)).status, 401);
  actor = { id: 'm', role: 'member', teamId: 't', canReview: false };
  assert.equal((await controller.readSubmissionAnswer(req(), id)).status, 403, 'an ordinary participant cannot read others');
  actor = { id: 'a', role: 'admin', teamId: 't' };
  assert.equal((await controller.readSubmissionAnswer(req(), 'bad')).status, 400);
  const ok = await controller.readSubmissionAnswer(req(), id);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).answerText, long);
  answer = { forbidden: true };
  assert.equal((await controller.readSubmissionAnswer(req(), id)).status, 403, 'another team or branch');
});
