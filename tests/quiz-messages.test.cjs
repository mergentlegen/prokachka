// The mentor's texts after a test-only task. The database decides (tests/quiz-messages.sql); these check the site around it.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');
const hookHarness = require('./helpers/hook-harness.cjs');

const taskId = '22222222-2222-4222-8222-222222222222';
const questions = [
  { id: 'q1', kind: 'single', prompt: 'Сколько морей?', options: ['Одно', 'Два'], correct: [1] },
  { id: 'q2', kind: 'multiple', prompt: 'Что входит?', options: ['Каюта', 'Питание', 'Перелёт'], correct: [0, 1] },
];
const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap((item) => nodes(item, predicate))
  : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];

test('the texts are trimmed and kept short', () => {
  const { validateQuizMessages } = loadTs('shared/domain/task-quiz.ts');
  assert.deepEqual(validateQuizMessages({ passText: '  Отлично  ', failText: '' }), { messages: { passText: 'Отлично', failText: '' } });
  assert.deepEqual(validateQuizMessages(undefined), { messages: { passText: '', failText: '' } });
  assert.match(validateQuizMessages({ passText: 'а'.repeat(1001) }).error, /не длиннее 1000/);
});

function quizService(rpcAnswer, quizRow = {}) {
  const calls = [];
  const db = {
    from(table) {
      const result = table === 'task_quizzes'
        ? { data: { questions, pass_text: 'Молодец', fail_text: 'Пересмотри видео', tasks: { team_id: 'team', voice_answer: false }, ...quizRow }, error: null }
        : { data: null, error: null };
      const query = new Proxy({}, { get(_target, key) { return key === 'then' ? (resolve) => resolve(result) : () => query; } });
      return query;
    },
    rpc: async (name, args) => { calls.push([name, args]); return { data: rpcAnswer, error: null }; },
  };
  const service = loadTs('backend/services/task-quizzes.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db },
    '@/backend/services/task-access.service': { canOpenTaskMaterials: async () => true },
    '@/backend/services/task-videos.service': { canManageTaskMaterials: async () => true },
  });
  return { service, calls };
}

test('the mentor reads and saves the texts with the questions; an older page sending only questions keeps them', async () => {
  const mentor = { id: 'l', role: 'admin', teamId: 'team' };
  const read = await quizService(null).service.getQuizForEditing(mentor, taskId);
  assert.deepEqual(read.data.messages, { passText: 'Молодец', failText: 'Пересмотри видео' });
  const saved = quizService({ data: true });
  await saved.service.saveQuiz(mentor, taskId, questions, { passText: ' Отлично ', failText: 'Ещё раз' });
  assert.deepEqual([saved.calls[0][1].p_pass_text, saved.calls[0][1].p_fail_text], ['Отлично', 'Ещё раз']);
  const older = quizService({ data: true });
  await older.service.saveQuiz(mentor, taskId, questions);
  assert.deepEqual([older.calls[0][1].p_pass_text, older.calls[0][1].p_fail_text], [null, null], 'null leaves the texts as they are');
  const long = quizService({ data: true });
  assert.match((await long.service.saveQuiz(mentor, taskId, questions, { passText: 'а'.repeat(1001) })).validationError, /1000/);
  assert.equal(long.calls.length, 0);
});

test('the participant learns beforehand only whether a mistake returns the task, never the texts', async () => {
  const member = { id: 'm', role: 'member', teamId: 'team' };
  const withText = await quizService(null).service.getQuizForMember(member, taskId);
  assert.equal(withText.data.autoReturn, true);
  assert.doesNotMatch(JSON.stringify(withText.data), /Пересмотри|Молодец/);
  const without = await quizService(null, { fail_text: '' }).service.getQuizForMember(member, taskId);
  assert.equal(without.data.autoReturn, false);
});

test('after sending, the site gets the decision and the mentor’s own text only', async () => {
  const member = { id: 'm', role: 'member', teamId: 'team' };
  const wrong = { q1: { choice: [0] }, q2: { choice: [0, 1] } };
  const returned = await quizService({ data: { id: 's1', status: 'revision', points: 0, comment: 'Пересмотри видео' }, returned: true, message: 'Пересмотри видео' })
    .service.submitQuiz(member, taskId, wrong);
  assert.deepEqual([returned.data.returned, returned.data.accepted, returned.data.message], [true, false, 'Пересмотри видео']);
  const usual = await quizService({ data: { id: 's2', status: 'accepted', points: 10, comment: '' }, returned: false, message: 'Тест пройден без ошибок — засчитано автоматически.' })
    .service.submitQuiz(member, taskId, { q1: { choice: [1] }, q2: { choice: [0, 1] } });
  assert.deepEqual([usual.data.accepted, usual.data.message], [true, ''], 'no mentor text: no window, the usual notice');
  const waiting = await quizService({ data: { id: 's3', status: 'pending', points: 0, comment: '' }, returned: false, message: null }).service.submitQuiz(member, taskId, wrong);
  assert.deepEqual([waiting.data.returned, waiting.data.message], [false, '']);
});

test('the endpoints carry the texts both ways', async () => {
  let savedWith;
  const controller = loadTs('backend/controllers/task-quizzes.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'm', role: 'admin', teamId: 'team' }) },
    '@/backend/services/telegram-notifications.service': { scheduleTelegramDelivery: () => undefined },
    '@/backend/services/task-quizzes.service': {
      getQuizForEditing: async () => ({ data: { questions, messages: { passText: 'Да', failText: 'Нет' } } }),
      saveQuiz: async (_user, _task, input, messages) => { savedWith = messages; return { data: input }; },
      submitQuiz: async () => ({ data: { submission: { id: 's1', status: 'revision' }, score: 1, total: 2, accepted: false, returned: true, points: 0, message: 'Нет' } }),
    },
  });
  const read = await (await controller.readTaskQuiz(new Request('http://localhost/api/tasks/' + taskId + '/quiz?edit=1'), taskId)).json();
  assert.deepEqual(read.messages, { passText: 'Да', failText: 'Нет' });
  await controller.writeTaskQuiz(new Request('http://localhost/api/admin/tasks/' + taskId + '/quiz', { method: 'PUT', body: JSON.stringify({ questions, messages: { passText: 'А', failText: 'Б' } }) }), taskId);
  assert.deepEqual(savedWith, { passText: 'А', failText: 'Б' });
  const sent = await (await controller.sendTaskQuiz(new Request('http://localhost/api/tasks/' + taskId + '/quiz/submit', { method: 'POST', body: JSON.stringify({ answers: {} }) }), taskId)).json();
  assert.deepEqual([sent.returned, sent.message], [true, 'Нет']);
});

test('the editor offers the two texts only for a test without written questions or voice', () => {
  const { QuizEditor } = loadTs('frontend/features/admin/QuizEditor.tsx');
  const render = (props) => renderToStaticMarkup(React.createElement(QuizEditor, { questions, onChange() {}, onMessages() {}, ...props }));
  const testOnly = render({ testOnly: true, messages: { passText: 'Молодец', failText: '' } });
  assert.match(testOnly, /Ответ участнику после теста/);
  assert.match(testOnly, /Если всё верно/);
  assert.match(testOnly, /Если есть ошибки/);
  assert.match(testOnly, />Молодец<\/textarea>/);
  assert.doesNotMatch(render({ testOnly: false }), /Ответ участнику после теста/);
  assert.doesNotMatch(render({ testOnly: true, onMessages: undefined }), /Ответ участнику после теста/);
});

test('a program step saves its texts with its questions', async () => {
  const { publishProgram } = loadTs('frontend/features/admin/program-publish.ts');
  const saved = [];
  const api = {
    async createAdminProgram(input) { return { program: { id: 'p' }, tasks: input.tasks.map((task, index) => ({ id: `t${index + 1}`, title: task.title, position: index + 1 })) }; },
    async saveTaskQuiz(id, list, messages) { saved.push([id, list.length, messages]); return list; },
  };
  await publishProgram({ title: 'Тесты', deadlineHours: 48, level: 1, steps: [{ title: 'Тест', description: 'Ответьте', resourceUrl: '', maxPoints: 2, voiceAnswer: false, files: [], video: null,
    questions, messages: { passText: ' Верно ', failText: 'Ещё раз' } }] }, undefined, api);
  assert.deepEqual(saved, [['t1', 2, { passText: 'Верно', failText: 'Ещё раз' }]]);
});

test('the participant sees the mentor’s text in the notice; a returned test offers a retake and no score', () => {
  const { QuizSentNotice } = loadTs('frontend/features/member/TaskQuiz.tsx');
  const returned = renderToStaticMarkup(React.createElement(QuizSentNotice, { score: 1, total: 2, returned: true, message: 'Пересмотри видео', onRetry() {} }));
  assert.match(returned, /Есть ошибки — задание на доработке/);
  assert.match(returned, /Пересмотри видео/);
  assert.match(returned, /Пройти тест ещё раз/);
  assert.doesNotMatch(returned, /1 из 2/, 'how many were wrong is not shown');
  const accepted = renderToStaticMarkup(React.createElement(QuizSentNotice, { score: 2, total: 2, accepted: true, points: 10, message: 'Молодец' }));
  assert.match(accepted, /Без ошибок — задание засчитано/);
  assert.match(accepted, /Молодец/);
});

function openQuizCard(props = {}) {
  const harness = hookHarness();
  const real = loadTs('frontend/features/member/TaskQuiz.tsx');
  const progress = [];
  const { TaskCard } = loadTs('frontend/features/member/TaskCard.tsx', { react: { ...React, ...harness.react },
    './TaskQuiz': { ...real, TaskQuiz: function TaskQuizStub() { return React.createElement('div', null, 'ВОПРОСЫ'); } } });
  const task = { id: taskId, title: 'Тест', description: 'Ответьте', maxPoints: 10, isActive: true, publicationType: 'evergreen', createdAt: '2026-11-01', updatedAt: '2026-11-01', quiz: { questions: 2 } };
  let tree = harness.mount(TaskCard, { task, onSubmit: async () => undefined, onInteractiveProgress: () => progress.push(1), ...props });
  nodes(tree, (node) => node.type === 'button' && node.props['aria-haspopup'] === 'dialog')[0].props.onClick();
  tree = harness.render();
  const find = (name) => nodes(harness.render(), (node) => node.type?.name === name)[0];
  return { harness, progress, find, html: () => renderToStaticMarkup(harness.render()) };
}

test('a returned test: the window shows the text, the list refreshes once it is closed, «Пройти тест ещё раз» opens the questions', () => {
  const card = openQuizCard();
  card.find('TaskQuizStub').props.onSubmitted({ score: 1, total: 2, accepted: false, returned: true, points: 0, message: 'Пересмотри видео' });
  const html = card.html();
  assert.match(html, /Есть ошибки/);
  assert.match(html, /Задание вернулось на доработку/);
  assert.match(html, /останется в «Обратной связи»/);
  assert.equal(card.progress.length, 0, 'the list waits until the window is read');
  assert.equal((html.match(/Пересмотри видео/g) || []).length, 2, 'the text in the window and in the notice, not a third time as a comment');
  card.find('QuizResultPopup').props.onRetry();
  assert.equal(card.progress.length, 1);
  assert.equal(card.find('QuizResultPopup'), undefined);
  assert.match(card.html(), /ВОПРОСЫ/);
});

test('a passed test with the mentor’s text: «Тест пройден» and «Понятно»; without a text the usual notice and no window', () => {
  const card = openQuizCard();
  card.find('TaskQuizStub').props.onSubmitted({ score: 2, total: 2, accepted: true, returned: false, points: 10, message: 'Молодец' });
  assert.match(card.html(), /Тест пройден/);
  assert.match(card.html(), /Понятно/);
  card.find('QuizResultPopup').props.onClose();
  assert.equal(card.progress.length, 1);
  assert.match(card.html(), /Без ошибок — задание засчитано/);
  const plain = openQuizCard();
  plain.find('TaskQuizStub').props.onSubmitted({ score: 2, total: 2, accepted: true, returned: false, points: 10, message: '' });
  assert.equal(plain.find('QuizResultPopup'), undefined);
  assert.equal(plain.progress.length, 1);
});

test('the window sits beside the task window, and mentors see automatic returns', () => {
  const card = fs.readFileSync('frontend/features/member/TaskCard.tsx', 'utf8');
  assert.match(card, /<\/ModalSheet>\}\s*\{\/\*[^*]*\*\/\}\s*\{quizPopup && <QuizResultPopup/);
  for (const file of ['frontend/features/admin/AdminHistoryView.tsx', 'frontend/features/admin/TaskResultsSheet.tsx'])
    assert.match(fs.readFileSync(file, 'utf8'), /=== "revision"\) && \w+\.submission\?\.autoAccepted/, file);
});
