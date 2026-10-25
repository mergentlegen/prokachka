const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const value = (patch = {}) => ({ title: 'Видео-приветствие', description: 'Запиши видео на минуту', resourceUrl: '', maxPoints: '10', voiceAnswer: false, level: 1, hasDeadline: false, deadline: '', ...patch });
const materials = { attachments: [], files: [], onFilesChange() {}, onRemoveAttachment() {}, video: { file: null, removing: false, onFile() {}, onRemove() {} } };
const quiz = (questions = []) => ({ questions, loading: false, onChange() {} });
const question = { id: 'q1', kind: 'single', prompt: 'Сколько миль за шаг?', options: ['5', '10'], correct: [1] };

test('one set of rules checks every task form and names what is missing', () => {
  const { editorProblems, deadlineLabel, freshQuestions, validLink } = loadTs('frontend/features/admin/task-editor.ts');
  assert.deepEqual(editorProblems(value(), []), []);
  assert.deepEqual(editorProblems(value({ title: ' ', description: '' }), []).map((item) => item.field), ['title', 'description']);
  assert.deepEqual(editorProblems(value({ resourceUrl: 'youtube.com/x', maxPoints: '' }), []).map((item) => item.field), ['link', 'miles']);
  assert.deepEqual(editorProblems(value(), [{ id: 'x', kind: 'single', prompt: '', options: ['', ''], correct: [] }]).map((item) => item.field), ['quiz']);
  assert.equal(validLink('https://youtu.be/abc'), true);
  assert.equal(deadlineLabel(24), '1 день');
  assert.equal(deadlineLabel(72), '3 дня');
  assert.equal(deadlineLabel(168), 'Неделя');
  assert.equal(deadlineLabel(120), '5 дней');
  assert.equal(deadlineLabel(36), '36 часов');
  const copied = freshQuestions([question]);
  assert.notEqual(copied[0].id, question.id, 'a copied question gets its own id');
  assert.deepEqual(copied[0].options, question.options);
});

test('the editor has five blocks in the order the participant sees the task', () => {
  const { TaskEditorFields } = loadTs('frontend/features/admin/TaskEditorFields.tsx');
  const render = (props) => renderToStaticMarkup(React.createElement(TaskEditorFields, { mode: 'task', value: value(), onChange() {}, materials, quiz: quiz(), disabled: false, onError() {}, ...props }));
  const html = render({});
  const order = ['>Задание</h3>', '>Материалы</h3>', '>Проверка знаний</h3>', '>Как участник отвечает</h3>', '>Настройки</h3>'].map((marker) => html.indexOf(marker));
  assert.ok(order.every((index) => index > 0), 'all five blocks are there');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const tile of ['<b>Видео</b>', '<b>PDF</b>', '<b>Ссылка</b>']) assert.ok(html.includes(tile), tile);
  assert.match(html, /Для кого/);
  assert.match(html, /aria-pressed="true"[^>]*><b>10<\/b><small>миль/, 'miles are picked with ready buttons');
  assert.match(html, /<b>Без срока<\/b>/);
  const step = render({ mode: 'step', stepDeadlineHours: 72 });
  assert.doesNotMatch(step, /Для кого/, 'a program step follows the program level');
  assert.match(step, /3 дня на шаг/);
  const withQuiz = render({ quiz: quiz([question]) });
  assert.match(withQuiz, /Только тест на сайте/);
  assert.match(withQuiz, /Тест и голосовое/);
  const game = render({ interactive: true });
  assert.doesNotMatch(game, /Как участник отвечает/);
  const errors = render({ value: value({ title: '' }), problems: [{ field: 'title', message: 'нет названия' }], showProblems: true });
  assert.match(errors, /Нужно исправить: нет названия/);
});

test('the preview shows the task like a participant: description, video, PDF, link, questions, then the button', () => {
  const { TaskPreview } = loadTs('frontend/features/admin/TaskPreview.tsx');
  const html = renderToStaticMarkup(React.createElement(TaskPreview, {
    value: value({ resourceUrl: 'https://example.com/guide', voiceAnswer: true }), mode: 'step', stepDeadlineHours: 48,
    video: 'Приветствие.mp4', pdfs: [{ name: 'Правила клуба.pdf', size: 2_400_000 }], questions: [question],
  }));
  const order = ['Запиши видео на минуту', 'Срок: 2 дня на шаг', 'Приветствие.mp4', 'Правила клуба.pdf', 'example.com', 'Сколько миль за шаг?', 'Ответить и записать голосовое'].map((text) => html.indexOf(text));
  assert.ok(order.every((index) => index > 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(html, /2\.3 МБ/);
  const empty = renderToStaticMarkup(React.createElement(TaskPreview, { value: value({ title: '', description: '' }), mode: 'task', video: null, pdfs: [], questions: [] }));
  assert.match(empty, /Название задания/);
  assert.match(empty, />Отправить ответ</);
});

test('PDF files: only PDFs up to 15 MB, no doubles, ten at most', () => {
  const { addPdfFiles } = loadTs('frontend/features/admin/TaskFilePicker.tsx');
  const pdf = (name, size = 1000) => ({ name, size, type: 'application/pdf', lastModified: 1 });
  const first = addPdfFiles([pdf('a.pdf'), { name: 'b.docx', size: 10, type: 'application/msword', lastModified: 1 }], [], []);
  assert.deepEqual(first.files.map((file) => file.name), ['a.pdf']);
  assert.match(first.warning, /только PDF/);
  assert.equal(addPdfFiles([pdf('a.pdf')], [], first.files).files.length, 1, 'the same file is not added twice');
  assert.equal(addPdfFiles([pdf('big.pdf', 16 * 1024 * 1024)], [], []).files.length, 0);
  const full = addPdfFiles([pdf('11.pdf')], Array.from({ length: 10 }, (_, index) => ({ id: String(index) })), []);
  assert.match(full.warning, /не больше 10/);
});

test('a new program is published in the order of the list: games are added, then the steps are put in place', async () => {
  const { publishProgram } = loadTs('frontend/features/admin/program-publish.ts');
  const calls = [];
  const api = {
    async createAdminProgram(input) { calls.push(['create', input.tasks.map((task) => task.title)]); return { program: { id: 'p' }, tasks: input.tasks.map((task, index) => ({ id: `t${index + 1}`, title: task.title, position: index + 1 })) }; },
    async uploadTaskAttachment(taskId, file) { if (file.name === 'bad.pdf') throw new Error('no'); calls.push(['pdf', taskId, file.name]); return { id: 'a', fileName: file.name }; },
    async updateAdminTask(taskId, patch) { calls.push(['voice', taskId, patch.voiceAnswer]); return { id: taskId, voiceAnswer: true }; },
    async saveTaskQuiz(taskId, questions) { calls.push(['quiz', taskId, questions.length]); return questions; },
    async uploadTaskVideo() { throw new Error('no video'); },
    async addProgramGame(programId, kind) { calls.push(['game', programId, kind]); return { task: { id: 'g1', title: 'Игра' } }; },
    async reorderProgramSteps(programId, ids) { calls.push(['order', programId, ids]); },
  };
  const step = (title, patch = {}) => ({ title, description: 'Описание', resourceUrl: '', maxPoints: 10, voiceAnswer: false, files: [], video: null, questions: [], ...patch });
  const progress = [];
  const result = await publishProgram({ title: 'Старт', deadlineHours: 72, level: 1, steps: [
    step('Знакомство', { files: [{ name: 'guide.pdf' }, { name: 'bad.pdf' }], voiceAnswer: true, questions: [question] }),
    step('Вахта безопасности', { game: 'safety-watch' }),
    step('Контакты', { video: { name: 'clip.mp4' } }),
  ] }, (text) => progress.push(text), api);
  assert.deepEqual(calls[0], ['create', ['Знакомство', 'Контакты']], 'games are not created as normal steps');
  assert.ok(calls.some((call) => call[0] === 'pdf' && call[2] === 'guide.pdf'));
  assert.ok(calls.some((call) => call[0] === 'voice' && call[1] === 't1'));
  assert.ok(calls.some((call) => call[0] === 'quiz' && call[1] === 't1'));
  assert.deepEqual(calls.find((call) => call[0] === 'game'), ['game', 'p', 'safety-watch']);
  assert.deepEqual(calls.find((call) => call[0] === 'order'), ['order', 'p', ['t1', 'g1', 't2']], 'the game takes its place between the two steps');
  assert.deepEqual(result.tasks.map((task) => [task.id, task.position]), [['t1', 1], ['g1', 2], ['t2', 3]]);
  assert.deepEqual(result.failed, ['PDF «bad.pdf» (шаг 1)', 'видео шага 3'], 'a failed extra is reported, the program stays');
  assert.ok(progress.some((text) => text.startsWith('Шаг 3: загружаем видео')));
});

test('a program without games keeps the order it was created in — no extra reorder call', async () => {
  const { publishProgram } = loadTs('frontend/features/admin/program-publish.ts');
  let reordered = false;
  const api = { async createAdminProgram(input) { return { program: { id: 'p' }, tasks: input.tasks.map((task, index) => ({ id: `t${index}`, position: index + 1 })) }; }, async reorderProgramSteps() { reordered = true; } };
  const result = await publishProgram({ title: 'Т', deadlineHours: 24, level: 2, steps: [{ title: 'А', description: 'Д', resourceUrl: '', maxPoints: 5, voiceAnswer: false, files: [], video: null, questions: [] }] }, undefined, api);
  assert.equal(reordered, false);
  assert.equal(result.failed.length, 0);
});

test('drafts are kept in this browser; a copy of a task or step is one tap away', () => {
  const { savedAtText, taskDraftKey, programDraftKey } = loadTs('frontend/features/admin/editor-drafts.ts');
  const now = new Date(2026, 9, 25, 15, 0).getTime();
  assert.equal(savedAtText(new Date(2026, 9, 25, 14, 5).toISOString(), now), 'сегодня в 14:05');
  assert.equal(savedAtText(new Date(2026, 9, 24, 9, 30).toISOString(), now), 'вчера в 09:30');
  assert.notEqual(taskDraftKey('a'), taskDraftKey('b'), 'each mentor has their own draft');
  assert.notEqual(taskDraftKey('a'), programDraftKey('a'));
  assert.match(read('frontend/features/admin/AdminTasksView.tsx'), /label: "Создать копию"/);
  assert.match(read('frontend/features/admin/ProgramsPanel.tsx'), /label: "Создать копию"/);
  assert.match(read('frontend/features/admin/ProgramEditorModal.tsx'), /label: "Создать копию"/);
  const app = read('frontend/features/admin/AdminApp.tsx');
  assert.match(app, /A copy keeps the deadline only while it is still ahead/);
  assert.match(app, /freshQuestions\(questions\)/, 'copied questions get new ids');
});
