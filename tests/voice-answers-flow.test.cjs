const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const dbKey = '@/backend/infrastructure/supabase/admin-client';
const almaty = (iso) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' }).format(new Date(iso));

function telegramController() {
  return loadTs('backend/controllers/telegram.controller.ts', {
    '@/backend/services/telegram-submission.service': { attachTelegramSubmission: async () => ({}), beginTelegramSubmission: async () => ({}) },
    '@/backend/services/telegram-link.service': { createTelegramLinkToken: async () => ({}), linkTelegramAccount: async () => ({}) },
    '@/backend/services/telegram-notifications.service': { scheduleTelegramDelivery() {}, sendTelegramMessage: async () => ({ ok: true }) },
    '@/backend/config/env': { isValidTelegramSecret: () => true, serverEnv: {} },
    [dbKey]: { getSupabaseAdmin: () => null },
  });
}

test('the bot says what to send, how to record a voice, that the test is kept and until when', () => {
  const { selectedTaskText } = telegramController();
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const voice = selectedTaskText({ voice: true, quiz: true, title: 'Тест и рассказ', expiresAt });
  assert.match(voice, /🎙 Задание «Тест и рассказ» выбрано\. Ответ — голосовое сообщение\./);
  assert.match(voice, /удерживайте микрофон 🎤/);
  assert.match(voice, /Ответы на тест уже сохранены/);
  assert.ok(voice.includes('до ' + almaty(expiresAt)), 'the deadline time in Almaty');
  assert.match(voice, /задание останется неотправленным/);
  const plain = selectedTaskText({ title: 'Гайд', expiresAt });
  assert.match(plain, /текст, фото, видео или файл/);
  assert.doesNotMatch(plain, /микрофон/);
});

test('the bot explains wrong messages and that they can be sent again; success names what was sent', () => {
  const { unsupportedMessageText, savedAnswerText } = telegramController();
  const audio = unsupportedMessageText('Аудиофайл');
  assert.match(audio, /^❌ Аудиофайл бот не принимает как ответ\./);
  assert.match(audio, /микрофон 🎤/);
  assert.match(audio, /↻ Просто отправьте ещё раз/);
  assert.match(savedAnswerText({ media_type: 'voice', quiz_total: 3 }), /Голосовое и ответы на тест отправлены/);
  assert.match(savedAnswerText({ media_type: 'voice', quiz_total: null }), /Голосовое получено/);
  assert.match(savedAnswerText({ media_type: 'text' }), /Ответ сохранён/);
});

test('after 30 minutes without an answer the participant hears the task was not sent', () => {
  const { submissionTimeoutText } = loadTs('backend/services/telegram-notifications.service.ts');
  const quiz = submissionTimeoutText('Тест и рассказ', true, true, 'https://prokachka.kz/?tab=tasks');
  assert.match(quiz, /⏰ Прошло 30 минут/);
  assert.match(quiz, /задание не отправлено/);
  assert.match(quiz, /«Ответить и записать голосовое»/);
  assert.match(quiz, /Ответы на тест сохранены/);
  assert.match(submissionTimeoutText('Видео', true, false, ''), /«🎙 Записать голосовое»/);
  assert.match(submissionTimeoutText('Гайд', false, false, ''), /«Отправить ответ»/);
});

test('a link to the bot lasts 30 minutes and carries the test answers', async () => {
  const inserted = [];
  const query = (table) => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: 'm', role: 'member', telegram_id: '1' }, error: null }; },
    async insert(row) { inserted.push([table, row]); return { error: null }; } });
  const service = loadTs('backend/services/telegram-submission.service.ts', {
    [dbKey]: { getSupabaseAdmin: () => ({ from: query, rpc: async () => ({ data: null, error: null }) }) },
    '@/backend/config/env': { serverEnv: { telegramBotUsername: 'bot', telegramBotToken: 'x' } },
  });
  assert.equal(service.SUBMISSION_MINUTES, 30);
  const link = await service.prepareTelegramSubmission('m', 't', 'answer', { quiz: { text: 'ответы', score: 1, total: 2, answers: {} } });
  const row = inserted.find(([table]) => table === 'telegram_submission_sessions')[1];
  const minutes = (Date.parse(row.expires_at) - Date.now()) / 60_000;
  assert.ok(minutes > 29 && minutes <= 30, 'expires in 30 minutes');
  assert.deepEqual(row.metadata.quiz, { text: 'ответы', score: 1, total: 2, answers: {} });
  assert.match(link.url, /start=submit_/);
});

test('a test of a voice task is checked and kept with the link, not saved as a work', async () => {
  const rpcs = [], links = [];
  const quizRow = { questions: [{ id: 'q1', kind: 'text', prompt: 'Что запомнил?' }], tasks: { team_id: 'team', voice_answer: true } };
  const db = { rpc: async (name) => { rpcs.push(name); return { data: null, error: null }; },
    from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: quizRow, error: null }; }, async upsert() { return { error: null }; } }) };
  const service = loadTs('backend/services/task-quizzes.service.ts', {
    [dbKey]: { getSupabaseAdmin: () => db },
    '@/backend/services/telegram-submission.service': { prepareTelegramSubmission: async (...args) => { links.push(args); return { url: 'https://t.me/bot?start=submit_x', expiresAt: '2026-10-21T10:30:00Z' }; } },
    '@/backend/services/task-access.service': { canOpenTaskMaterials: async () => true },
    '@/backend/services/task-videos.service': { canManageTaskMaterials: async () => false },
  });
  const result = await service.submitQuiz({ id: 'm', role: 'member', teamId: 'team' }, 't', { q1: { text: 'Многое' } });
  assert.deepEqual(result.data.voice, { url: 'https://t.me/bot?start=submit_x', expiresAt: '2026-10-21T10:30:00Z' });
  assert.deepEqual(rpcs, ['app_task_quiz_check'], 'checked only; app_task_quiz_submit is not called');
  assert.equal(links[0][2], 'answer');
  assert.match(links[0][3].quiz.text, /Многое/);
});

test('the site says the voice is still to be recorded, with the time and a way back to Telegram', () => {
  const { VoicePendingNotice } = loadTs('frontend/features/member/TaskQuiz.tsx');
  const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString();
  const html = renderToStaticMarkup(React.createElement(VoicePendingNotice, { url: 'https://t.me/bot?start=submit_x', expiresAt }));
  assert.match(html, /Осталось записать голосовое/);
  assert.match(html, /без него задание не отправится/);
  assert.match(html, /href="https:\/\/t\.me\/bot\?start=submit_x"/);
});
