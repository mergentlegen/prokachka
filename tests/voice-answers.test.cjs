const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const task = { id: 't', title: 'Расскажи о себе', description: 'Голосовое на минуту', maxPoints: 10, isActive: true, publicationType: 'evergreen', createdAt: '2026-09-01', updatedAt: '2026-09-01' };

test('a voice task asks the participant to record a voice message in Telegram', () => {
  const { TaskCard } = loadTs('frontend/features/member/TaskCard.tsx');
  const voice = renderToStaticMarkup(React.createElement(TaskCard, { task: { ...task, voiceAnswer: true }, onSubmit: async () => undefined }));
  assert.match(voice, /🎙 Записать голосовое/);
  assert.match(voice, /Ответ — голосовое сообщение в Telegram/);
  const again = renderToStaticMarkup(React.createElement(TaskCard, { task: { ...task, voiceAnswer: true }, onSubmit: async () => undefined,
    submission: { id: 's', userId: 'm', taskId: 't', status: 'revision', points: 0, comment: 'Подробнее', submittedAt: '2026-09-02', reviewVersion: 1 } }));
  assert.match(again, /Записать голосовое заново/);
  const plain = renderToStaticMarkup(React.createElement(TaskCard, { task, onSubmit: async () => undefined }));
  assert.match(plain, /Отправить ответ/);
  assert.doesNotMatch(plain, /Записать голосовое|Ответ — голосовое/);
});

test('the flag travels from the database to the screen', () => {
  const { mapTask } = loadTs('frontend/shared/api/client.ts');
  assert.equal(mapTask({ id: 't', title: 'x', voice_answer: true }).voiceAnswer, true);
  assert.equal('voiceAnswer' in mapTask({ id: 't', title: 'x', voice_answer: false }), false);
});

test('the mentor switches «Ответ голосовым» in the task form; games have no such switch', () => {
  const { TaskEditorModal } = loadTs('frontend/features/admin/AdminModals.tsx', { '@/frontend/shared/FormSheet': { FormSheet: ({ children }) => React.createElement(React.Fragment, null, children) } });
  const draft = { title: '', description: '', resourceUrl: '', maxPoints: '10', hasDeadline: false, deadline: '', level: 1, voiceAnswer: true };
  const props = { draft, editing: false, busy: false, attachments: [], files: [], onFilesChange() {}, onRemoveAttachment() {}, onChange() {}, onClose() {}, onSubmit() {},
    video: { file: null, removing: false, onFile() {}, onRemove() {}, onError() {} }, quiz: { questions: [], loading: false, onChange() {} } };
  const html = renderToStaticMarkup(React.createElement(TaskEditorModal, props));
  assert.match(html, /Ответ голосовым в Telegram/);
  assert.match(html, /бот примет только его/);
  const game = renderToStaticMarkup(React.createElement(TaskEditorModal, { ...props, task: { ...task, interactiveKind: 'dream-plan' }, editing: true }));
  assert.doesNotMatch(game, /Ответ голосовым/);
});

test('a new task and an edit save the flag', async () => {
  const saved = [];
  const query = { insert(row) { saved.push(['insert', row]); return this; }, update(row) { saved.push(['update', row]); return this; }, select() { return this; }, eq() { return this; },
    async single() { return { data: { id: 't' }, error: null }; },
    async maybeSingle() { return { data: { id: 't', team_id: 'team', publisher_id: 'a', program_id: null, interactive_kind: null, publication_type: 'evergreen' }, error: null }; } };
  const service = loadTs('backend/services/tasks.service.ts', { '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ from: () => query }) } });
  await service.insertTask({ title: 'Голос', description: 'Запиши', teamId: 'team', voiceAnswer: true });
  await service.patchTask('t', { voiceAnswer: false }, { id: 'a', role: 'admin', teamId: 'team' });
  assert.equal(saved[0][1].voice_answer, true);
  assert.deepEqual(saved[1], ['update', { voice_answer: false }]);
});
