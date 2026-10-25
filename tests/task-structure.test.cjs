const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

test('PDF materials keep their real name and size in the task list and right after upload', () => {
  const { mapTaskAttachment, mapTask } = loadTs('frontend/shared/api/client.ts');
  // The task list answers in camelCase — this used to turn every file into «document.pdf», 1 КБ.
  const listed = mapTaskAttachment({ id: 'a', fileName: 'Правила клуба.pdf', sizeBytes: 2_400_000, createdAt: '2026-10-01T10:00:00Z' });
  assert.equal(listed.fileName, 'Правила клуба.pdf');
  assert.equal(listed.sizeBytes, 2_400_000);
  // The upload answer is in snake_case.
  const uploaded = mapTaskAttachment({ id: 'b', file_name: 'Скрипт звонка.pdf', size_bytes: 51_200, created_at: '2026-10-01T10:00:00Z' });
  assert.equal(uploaded.fileName, 'Скрипт звонка.pdf');
  assert.equal(uploaded.sizeBytes, 51_200);
  const task = mapTask({ id: 't', title: 'Т', attachments: [{ id: 'a', fileName: 'Гайд.pdf', sizeBytes: 10 }] });
  assert.equal(task.attachments[0].fileName, 'Гайд.pdf');
});

test('a task opens in order: description, then video, PDF and link, then the game or test, then the answer', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/features/member/TaskCard.tsx'), 'utf8');
  const at = (marker) => { const index = source.indexOf(marker); assert.ok(index > 0, marker); return index; };
  const order = ['{task.description}</div>', '<ProtectedVideo taskId', '<TaskAttachments taskId', '<ResourceCard url={resource}', '<DreamPlanGame taskId', '<TaskQuiz taskId', '<QuizReview taskId', 'Ваш ответ</strong>'].map(at);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'blocks follow the agreed order');
});
