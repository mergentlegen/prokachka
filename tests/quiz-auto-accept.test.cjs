// A test answered without mistakes counts at once; the database decides (tests/quiz-auto-accept.sql), these check the site around it.
const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const task = '22222222-2222-4222-8222-222222222222';
const questions = [
  { id: 'q1', kind: 'single', prompt: 'Сколько морей?', options: ['Одно', 'Два'], correct: [1] },
  { id: 'q2', kind: 'multiple', prompt: 'Что входит?', options: ['Каюта', 'Питание', 'Перелёт'], correct: [0, 1] },
];

test('only a test without a written question or a voice message can count at once', () => {
  const { quizIsTestOnly } = loadTs('shared/domain/task-quiz.ts');
  assert.equal(quizIsTestOnly(questions, false), true);
  assert.equal(quizIsTestOnly([...questions, { id: 'q3', kind: 'text', prompt: 'Почему?' }], false), false, 'a written answer needs a person');
  assert.equal(quizIsTestOnly(questions, true), false, 'a voice message needs a person');
  assert.equal(quizIsTestOnly([], false), false);
});

function quizService(rpcAnswer) {
  const db = {
    from(table) {
      const result = table === 'task_quizzes' ? { data: { questions, tasks: { team_id: 'team' } }, error: null } : { data: null, error: null };
      const query = new Proxy({}, { get(_target, key) { return key === 'then' ? (resolve) => resolve(result) : () => query; } });
      return query;
    },
    rpc: async () => ({ data: rpcAnswer, error: null }),
  };
  return loadTs('backend/services/task-quizzes.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db },
    '@/backend/services/task-access.service': { canOpenTaskMaterials: async () => true },
    '@/backend/services/task-videos.service': { canManageTaskMaterials: async () => true },
  });
}

test('the server tells the site whether the database accepted the test at once, and with how many miles', async () => {
  const member = { id: 'm', role: 'member', teamId: 'team' };
  const right = { q1: { choice: [1] }, q2: { choice: [0, 1] } };
  const accepted = await quizService({ data: { id: 's1', status: 'accepted', points: 10 } }).submitQuiz(member, task, right);
  assert.deepEqual([accepted.data.accepted, accepted.data.points, accepted.data.score, accepted.data.total], [true, 10, 2, 2]);
  const waiting = await quizService({ data: { id: 's2', status: 'pending', points: 0 } }).submitQuiz(member, task, { q1: { choice: [0] }, q2: { choice: [0, 1] } });
  assert.deepEqual([waiting.data.accepted, waiting.data.points, waiting.data.score], [false, 0, 1]);
});

test('the endpoint passes the decision on to the participant’s screen', async () => {
  const controller = loadTs('backend/controllers/task-quizzes.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'm', role: 'member', teamId: 'team' }) },
    '@/backend/services/telegram-notifications.service': { scheduleTelegramDelivery: () => undefined },
    '@/backend/services/task-quizzes.service': {
      submitQuiz: async () => ({ data: { submission: { id: 's1', status: 'accepted' }, score: 2, total: 2, accepted: true, points: 10 } }),
    },
  });
  const sent = await controller.sendTaskQuiz(new Request('http://localhost/api/tasks/' + task + '/quiz/submit', { method: 'POST', body: JSON.stringify({ answers: {} }) }), task);
  assert.equal(sent.status, 201);
  const body = await sent.json();
  assert.deepEqual([body.accepted, body.points, body.score], [true, 10, 2]);
});

test('the participant sees «засчитано» with the miles, or that the mentor will check the answers', () => {
  const { QuizSentNotice } = loadTs('frontend/features/member/TaskQuiz.tsx');
  const accepted = renderToStaticMarkup(React.createElement(QuizSentNotice, { score: 2, total: 2, accepted: true, points: 10 }));
  assert.match(accepted, /Без ошибок — задание засчитано/);
  assert.match(accepted, /Тест: 2 из 2 верно\. \+10 миль\./);
  assert.match(accepted, /Наставник проверять не будет/);
  const waiting = renderToStaticMarkup(React.createElement(QuizSentNotice, { score: 1, total: 2 }));
  assert.match(waiting, /Ответы отправлены наставнику/);
  assert.match(waiting, /Тест: 1 из 2 верно/);
  assert.doesNotMatch(waiting, /засчитано/);
});

test('mentors see which works were accepted automatically', () => {
  const { mapSubmission } = loadTs('frontend/shared/api/client.ts');
  const row = { id: 's', user_id: 'u', task_id: 't', status: 'accepted', submission_source: 'site', points: 10, review_version: 0 };
  assert.equal(mapSubmission({ ...row, auto_accepted: true }).autoAccepted, true);
  assert.equal(mapSubmission({ ...row, auto_accepted: false }).autoAccepted, undefined);
});
