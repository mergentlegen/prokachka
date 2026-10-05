const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

const quiz = loadTs('shared/domain/task-quiz.ts');
const task = '22222222-2222-4222-8222-222222222222';
const questions = [
  { id: 'q1', kind: 'single', prompt: 'Сколько морей?', options: ['Одно', 'Два', 'Три'], correct: [1] },
  { id: 'q2', kind: 'multiple', prompt: 'Что входит в круиз?', options: ['Каюта', 'Питание', 'Перелёт'], correct: [0, 1] },
  { id: 'q3', kind: 'text', prompt: 'Что вы забрали для себя?' },
];

test('the editor rules catch every common mistake in plain words', () => {
  assert.deepEqual(quiz.validateQuiz(questions).questions.map((question) => question.id), ['q1', 'q2', 'q3']);
  const broken = (patch, index = 0) => quiz.validateQuiz(questions.map((question, position) => position === index ? { ...question, ...patch } : question)).error;
  assert.match(broken({ prompt: ' ' }), /Вопрос 1: напишите текст/);
  assert.match(broken({ options: ['Одно'] }), /хотя бы два варианта/);
  assert.match(broken({ options: ['Одно', ''] }), /заполните все варианты/);
  assert.match(broken({ options: ['Да', 'да'], correct: [0] }), /повторяются/);
  assert.match(broken({ correct: [] }), /отметьте верный ответ/);
  assert.match(broken({ correct: [0, 1] }), /верный вариант должен быть один/);
  assert.match(broken({ kind: 'essay' }), /выберите тип/);
  assert.match(quiz.validateQuiz([questions[0], questions[0]]).error, /внутренняя ошибка/);
  assert.match(quiz.validateQuiz(Array.from({ length: 31 }, (_, index) => ({ ...questions[2], id: 'x' + index }))).error, /не больше 30/);
  assert.deepEqual(quiz.validateQuiz([]).questions, [], 'an empty list removes the questions');
});

test('participants never receive the correct choices', () => {
  const shown = quiz.publicQuiz(questions);
  assert.ok(shown.every((question) => !('correct' in question)));
  assert.deepEqual(shown[0].options, ['Одно', 'Два', 'Три']);
});

test('answers are cleaned, and the first gap is found', () => {
  const answers = quiz.cleanAnswers(quiz.publicQuiz(questions), { q1: { choice: [1, 2, 9] }, q2: { choice: [5] }, q3: { text: '   ' }, hacked: { text: 'x' } });
  assert.deepEqual(answers, { q1: { choice: [1] } }, 'single keeps one, impossible options and blanks are dropped');
  assert.equal(quiz.firstUnanswered(questions, answers), 2);
  assert.equal(quiz.firstUnanswered(questions, { q1: { choice: [1] }, q2: { choice: [0] }, q3: { text: 'Многое' } }), 0);
});

test('the test is scored and written for the mentor without revealing the right options', () => {
  const graded = quiz.gradeQuiz(questions, { q1: { choice: [1] }, q2: { choice: [0] }, q3: { text: 'Слушать гостя' } });
  assert.equal(graded.score, 1);
  assert.equal(graded.total, 2);
  assert.match(graded.text, /^Тест: 1 из 2 верно/);
  assert.match(graded.text, /1\. Сколько морей\?\n✓ Два/);
  assert.match(graded.text, /✓ Каюта\n\(выбраны не все верные варианты\)/);
  assert.match(graded.text, /3\. Что вы забрали для себя\?\nОтвет: Слушать гостя/);
  assert.doesNotMatch(graded.text, /Питание/, 'an unchosen right option is never named');
  assert.match(quiz.gradeQuiz([questions[2]], { q3: { text: 'x' } }).text, /^Ответы на вопросы/);
});

test('sending scores on the server and passes the result to the database in one call', async () => {
  const calls = [];
  const db = {
    from(table) {
      const result = table === 'task_quizzes' ? { data: { questions, tasks: { team_id: 'team' } }, error: null } : { data: null, error: null };
      const query = new Proxy({}, { get(_target, key) { return key === 'then' ? (resolve) => resolve(result) : () => query; } });
      return query;
    },
    rpc: async (name, args) => { calls.push([name, args]); return { data: { data: { id: 's1' } }, error: null }; },
  };
  const service = loadTs('backend/services/task-quizzes.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db },
    '@/backend/services/task-access.service': { canOpenTaskMaterials: async () => true },
    '@/backend/services/task-videos.service': { canManageTaskMaterials: async () => true },
  });
  const member = { id: 'm', role: 'member', teamId: 'team' };
  assert.equal((await service.submitQuiz(member, task, { q1: { choice: [1] } })).validationError, 'Ответьте на вопрос 2.');
  assert.equal(calls.length, 0, 'nothing sent with gaps');
  const sent = await service.submitQuiz(member, task, { q1: { choice: [0] }, q2: { choice: [0, 1] }, q3: { text: 'Да' } });
  assert.deepEqual([sent.data.score, sent.data.total], [1, 2]);
  const [name, args] = calls[0];
  assert.equal(name, 'app_task_quiz_submit');
  assert.equal(args.p_score, 1);
  assert.match(args.p_answer_text, /✗ Одно/);
  assert.equal((await service.submitQuiz({ ...member, teamId: 'other' }, task, {})).forbidden, true, 'another team');
  assert.equal((await service.submitQuiz({ ...member, role: 'admin' }, task, {})).forbidden, true, 'mentors do not answer');
  const mine = await service.getQuizForMember(member, task);
  assert.ok(mine.data.questions.every((question) => !('correct' in question)));
});

test('quiz endpoints: the editor copy is for managers, sending wakes the mentor notification', async () => {
  let actor = { id: 'm', role: 'member', teamId: 'team' }, deliveries = 0;
  const controller = loadTs('backend/controllers/task-quizzes.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => actor },
    '@/backend/services/telegram-notifications.service': { scheduleTelegramDelivery: () => deliveries++ },
    '@/backend/services/task-quizzes.service': {
      getQuizForEditing: async () => ({ forbidden: true }), getQuizForMember: async () => ({ data: { questions: [], answers: {}, videoRequired: false, videoCompleted: true } }),
      saveQuiz: async () => ({ validationError: 'Вопрос 1: напишите текст вопроса.' }), saveQuizDraft: async () => ({ data: true }),
      submitQuiz: async () => ({ data: { submission: { id: 's1' }, score: 3, total: 4 } }), taskVideoViews: async () => ({ forbidden: true }),
    },
  });
  const req = (method, query = '', body) => new Request('http://localhost/api/tasks/' + task + '/quiz' + query, { method, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await controller.readTaskQuiz(req('GET', '?edit=1'), task)).status, 403);
  assert.equal((await controller.readTaskQuiz(req('GET'), task)).status, 200);
  const saved = await controller.writeTaskQuiz(req('PUT', '', { questions: [{}] }), task);
  assert.equal(saved.status, 400);
  assert.match((await saved.json()).message, /напишите текст/);
  const sent = await controller.sendTaskQuiz(req('POST', '/submit', { answers: {} }), task);
  assert.equal(sent.status, 201);
  assert.deepEqual([(await sent.json()).score, deliveries], [3, 1]);
  assert.equal((await controller.readTaskVideoViews(req('GET'), task)).status, 403);
  actor = null;
  assert.equal((await controller.readTaskQuiz(req('GET'), task)).status, 401);
});
