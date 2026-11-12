// Takes the pictures of the product that the landing page shows (public/landing/*.webp).
// They are the real screens of the site, opened in Chrome and filled with an invented team:
// every /api/* answer is a fixture from this file, nothing is read from the database and no real person is shown.
//
// Run it again after the interface changes, so the landing never shows an old look:
//   1. npm run dev -- -p 3210          (in another terminal)
//   2. node scripts/capture-landing-shots.cjs
// LANDING_SHOTS_URL changes the address, LANDING_SHOTS_ONLY=program,feedback takes only some pictures.
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.LANDING_SHOTS_URL || 'http://localhost:3210';
const out = path.resolve(__dirname, '../public/landing');
const only = (process.env.LANDING_SHOTS_ONLY || '').split(',').filter(Boolean);
// The clock stands still, so «2 дня до срока» and the dates look the same on every run.
const NOW = new Date('2026-11-12T10:30:00+05:00');
const ago = (hours) => new Date(NOW.getTime() - hours * 3600000).toISOString();
const ahead = (hours) => new Date(NOW.getTime() + hours * 3600000).toISOString();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const TEAM = id(1);
const people = {
  aliya: { id: id(11), name: 'Алия Бекова' }, marat: { id: id(12), name: 'Марат Сейтов' }, timur: { id: id(13), name: 'Тимур Ахметов' },
  dana: { id: id(14), name: 'Дана Ким' }, ruslan: { id: id(15), name: 'Руслан Ибраев' }, olga: { id: id(16), name: 'Ольга Смирнова' },
  aigerim: { id: id(17), name: 'Айгерим Нурланова' }, erlan: { id: id(18), name: 'Ерлан Касымов' },
};
const account = (person, extra = {}) => {
  const [firstName, lastName] = person.name.split(' ');
  return { id: person.id, name: person.name, firstName, lastName, first_name: firstName, last_name: lastName, email: firstName.toLowerCase() + '@example.com',
    role: 'member', teamId: TEAM, team_id: TEAM, canReview: false, canPublishTasks: false, emailVerified: true, sessionVersion: 0,
    createdAt: ago(24 * 20), created_at: ago(24 * 20), teamJoinedAt: ago(24 * 20), team_joined_at: ago(24 * 20), telegramId: '1', hasTelegram: true, ...extra };
};

const PROGRAM = id(100);
const stepTitles = ['Видео о себе', 'Гайд по старту', 'Список из 20 контактов', 'Первая встреча', 'Разбор встречи', 'Приглашение на презентацию', 'Итоговый тест'];
const stepIds = stepTitles.map((_, index) => id(101 + index));
const stepRow = (index, extra = {}) => ({ id: stepIds[index], title: stepTitles[index], description: '', max_points: 10, is_active: true, team_id: TEAM,
  publication_type: 'sequential', program_id: PROGRAM, position: index + 1, program_title: 'Старт', program_steps: 7, deadline_hours: 72,
  created_at: ago(24 * 30), updated_at: ago(24 * 30), attachments: [], ...extra });
const currentStep = stepRow(3, { description: 'Проведи первую встречу с человеком из своего списка: расскажи о клубе и ответь на вопросы. После встречи запиши голосовое на 1–2 минуты: с кем говорил, что получилось и что было сложнее всего.',
  unlocked_at: ago(22), due_at: ahead(50), voice_answer: true });
const contactsTask = { id: id(120), title: 'Скрипт первого сообщения', description: 'Напиши своё первое сообщение для знакомого: коротко, без давления, с вопросом в конце. Наставник поправит формулировки.',
  max_points: 5, is_active: true, team_id: TEAM, publication_type: 'evergreen', created_at: ago(24 * 6), updated_at: ago(24 * 6), attachments: [] };
const memberSubmission = (n, taskId, title, status, points, hours, extra = {}) => ({ id: id(200 + n), user_id: people.aliya.id, task_id: taskId, tasks: { title, max_points: 10 },
  status, points, review_version: 1, submission_source: 'telegram', media_type: 'text', comment: '', submitted_at: ago(hours + 1), reviewed_at: status === 'pending' ? null : ago(hours), ...extra });

const member = {
  user: account(people.aliya),
  tasks: { tasks: [currentStep, contactsTask], passedTasks: [stepRow(0), stepRow(1), stepRow(2)],
    programs: [{ id: PROGRAM, title: 'Старт', is_pinned: false, status: 'active', current_task_id: stepIds[3],
      steps: stepTitles.map((title, index) => ({ id: stepIds[index], number: index + 1, title, max_points: 10 })) }] },
  submissions: { submissions: [
    memberSubmission(1, stepIds[0], stepTitles[0], 'accepted', 10, 24 * 9, { media_type: 'video' }),
    memberSubmission(2, stepIds[1], stepTitles[1], 'accepted', 10, 24 * 6),
    memberSubmission(3, stepIds[2], stepTitles[2], 'accepted', 10, 26, { comment: 'Отличный список. Начни с тех, кого отметила звёздочкой.' }),
    memberSubmission(4, contactsTask.id, contactsTask.title, 'pending', 0, 1),
  ] },
  ranking: { ranking: [[people.ruslan, 92], [people.olga, 84], [people.timur, 71], [people.aliya, 30], [people.dana, 25], [people.aigerim, 20], [people.erlan, 10]]
    .map(([person, points]) => ({ id: person.id, name: person.name, points })),
  starRanking: [[people.olga, 9], [people.ruslan, 5], [people.aliya, 1]].map(([person, points]) => ({ id: person.id, name: person.name, points })), level: 1, levelUp: null },
  announcements: { announcements: [{ id: id(300), team_id: TEAM, author_id: people.marat.id, author_name: people.marat.name, title: 'Разбор первых встреч — в субботу',
    content: 'В субботу в 11:00 собираемся в Zoom: разбираем ваши первые встречи и отвечаем на вопросы. Ссылка придёт в Telegram.', photos: [], is_active: true, is_pinned: false, created_at: ago(5), updated_at: ago(5) }] },
};

const THREAD = id(400);
const event = (seq, kind, author, body, hours, extra = {}) => ({ id: id(410 + seq), seq, kind, submissionId: id(203), authorId: author.id, authorName: author.name, body,
  reviewStatus: null, points: null, createdAt: ago(hours), ...extra });
const conversation = { id: THREAD, taskId: stepIds[2], taskTitle: stepTitles[2], memberId: people.aliya.id, memberName: people.aliya.name, needsReply: false, memberSeenSeq: 4,
  people: [people.aliya, people.marat].map(({ id: personId, name }) => ({ id: personId, name })),
  events: [
    event(1, 'submission', people.aliya, 'Составила список: 23 человека. Отметила тех, с кем общаюсь чаще всего.', 20.3),
    event(2, 'review', people.marat, 'Отличный список. Начни с тех, кого отметила звёздочкой.', 18.8, { reviewStatus: 'accepted', points: 10 }),
    event(3, 'message', people.aliya, 'Спасибо! А если человек сразу спросит про цену — что отвечать?', 18.6),
    event(4, 'message', people.marat, 'Не называй цену в переписке. Скажи, что всё покажешь на встрече за 15 минут, и предложи два времени на выбор.', 18.4),
  ] };
const feedbackThreads = [{ id: THREAD, taskId: stepIds[2], taskTitle: stepTitles[2], memberId: people.aliya.id, memberName: people.aliya.name, lastAt: ago(18.4), lastKind: 'message',
  lastBody: conversation.events[3].body, needsReply: false, unread: false, lastSeq: 4 }];

function memberApi(state) {
  const json = (body, status = 200) => ({ status, body: { ok: status < 400, ...body } });
  return (method, url) => {
    const key = method + ' ' + url.pathname;
    if (key === 'GET /api/auth/session') return state.signedIn ? json({ user: member.user, session: 'demo', devAuthMode: false }) : json({ message: 'Сессия не найдена.' }, 401);
    if (key === 'POST /api/auth/login') { state.signedIn = true; return json({ user: member.user, session: 'demo', devAuthMode: false }); }
    if (key === 'GET /api/tasks') return json(member.tasks);
    if (key === 'GET /api/submissions') return json(member.submissions);
    if (key === 'GET /api/ranking') return json(member.ranking);
    if (key === 'GET /api/announcements') return json(member.announcements);
    if (key === 'GET /api/stars') return json({ awards: [] });
    if (key === 'GET /api/network') return json({ users: [] });
    if (key === 'GET /api/welcome-video') return json({ required: false });
    if (key === 'GET /api/feedback') return url.searchParams.get('summary') ? json({ counts: { unread: 0, needsReply: 0 } }) : json({ threads: feedbackThreads });
    if (key === 'GET /api/feedback/' + THREAD) return json({ thread: conversation });
    if (key === 'GET /api/invitations/demo') return json({ invitation: { inviterName: people.marat.name, teamName: 'Команда Марата' } });
    if (key === 'GET /api/events') return { status: 204, body: null };
    if (process.env.LANDING_SHOTS_DEBUG) console.log('no fixture for ' + key + url.search);
    return json({});
  };
}

async function open(browser, api, viewport) {
  const problems = [];
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Asia/Almaty', serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.clock.setFixedTime(NOW);
  await context.route(/.*/, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const answer = api(request.method(), url);
    return route.fulfill({ status: answer.status, contentType: 'application/json; charset=utf-8', body: answer.body ? JSON.stringify(answer.body) : '' });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(error.message));
  if (process.env.LANDING_SHOTS_DEBUG) page.on('console', (message) => { if (message.type() === 'error') console.log('console: ' + message.text().slice(0, 300)); });
  // The dev-mode badge of Next.js is not part of the product.
  await page.addInitScript(() => { const hide = () => document.querySelectorAll('nextjs-portal').forEach((node) => node.remove()); new MutationObserver(hide).observe(document, { childList: true, subtree: true }); });
  return { page, problems, close: () => context.close() };
}

async function save(name, target, options = {}) {
  const sharp = require('sharp');
  const png = await target.screenshot({ type: 'png', ...options });
  const file = path.join(out, name + '.webp');
  const image = sharp(png).webp({ quality: 82 });
  await image.toFile(file);
  const { width, height } = await sharp(file).metadata();
  console.log(`${name}.webp  ${width}×${height}  ${Math.round(fs.statSync(file).size / 1024)} КБ`);
}

const PHONE = { width: 390, height: 844 };
const wants = (name) => !only.length || only.includes(name);

async function memberShots(browser) {
  if (wants('invite')) {
    const guest = await open(browser, memberApi({ signedIn: false }), PHONE);
    await guest.page.goto(base + '/?invite=demo', { waitUntil: 'load' });
    await guest.page.locator('input[name="email"]').waitFor({ timeout: 60000 });
    await guest.page.waitForTimeout(800);
    await save('invite', guest.page);
    await guest.close();
  }
  // Any parameter in the address opens the app itself instead of the landing page.
  const { page, problems, close } = await open(browser, memberApi({ signedIn: true }), PHONE);
  await page.goto(base + '/?tab=home', { waitUntil: 'load' });
  await page.getByRole('heading', { name: /Привет, Алия/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
  if (wants('program')) {
    await page.getByRole('button', { name: 'Задания' }).click();
    await page.getByRole('button', { name: 'Программы' }).click();
    await page.getByRole('button', { name: /Пройдено 3 из 7/ }).click();
    await page.waitForTimeout(900);
    await save('program', page);
  }
  if (wants('step')) {
    await page.getByRole('button', { name: 'Задания' }).first().click();
    await page.getByRole('button', { name: 'Программы' }).click();
    if (!await page.getByRole('button', { name: /Подробнее/ }).count()) await page.getByRole('button', { name: /Пройдено 3 из 7/ }).click();
    await page.getByRole('button', { name: /Подробнее/ }).first().click();
    await page.waitForTimeout(900);
    await save('step', page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  if (wants('ranking')) {
    await page.getByRole('button', { name: 'Рейтинг' }).click();
    await page.getByText(people.ruslan.name).first().waitFor();
    await page.waitForTimeout(400);
    await save('ranking', page);
  }
  if (wants('feedback')) {
    await page.getByRole('button', { name: 'Отклик' }).click();
    await page.getByRole('button', { name: new RegExp(stepTitles[2]) }).first().click();
    await page.getByText('Не называй цену').first().waitFor();
    await page.waitForTimeout(600);
    await save('feedback', page);
  }
  await close();
  if (problems.length) throw new Error('The participant screens had errors: ' + problems.join('; '));
}

// The mentor's side: the same team seen by Марат, who leads it.
const mentorUser = account(people.marat, { role: 'admin', canReview: true, canPublishTasks: true });
const teamRow = (person, parent, points, extra = {}) => ({ ...account(person), parent_user_id: parent.id, parentUserId: parent.id, points, stars: 0, recentSubmissions: 2, ...extra });
const team = [
  { ...mentorUser, points: 0 },
  teamRow(people.ruslan, people.marat, 92), teamRow(people.olga, people.marat, 84), teamRow(people.timur, people.marat, 71),
  teamRow(people.aliya, people.timur, 30), teamRow(people.dana, people.timur, 25), teamRow(people.aigerim, people.olga, 20), teamRow(people.erlan, people.olga, 10),
];
const teamSubmission = (n, person, taskIndex, status, hours, extra = {}) => ({ id: id(500 + n), user_id: person.id, task_id: stepIds[taskIndex], tasks: { title: stepTitles[taskIndex], max_points: 10 },
  status, points: status === 'accepted' ? 10 : 0, review_version: status === 'pending' ? 0 : 1, submission_source: 'telegram', media_type: 'text', comment: '',
  submitted_at: ago(hours), reviewed_at: status === 'pending' ? null : ago(Math.max(hours - 1, 0.2)), ...extra });
const mentor = {
  tasks: { tasks: [...stepTitles.map((_, index) => stepRow(index)), contactsTask] },
  programs: { programs: [{ id: PROGRAM, team_id: TEAM, title: 'Старт', deadline_hours: 72, is_active: true, is_pinned: false, created_at: ago(24 * 30), updated_at: ago(24 * 30) }] },
  submissions: { submissions: [
    teamSubmission(1, people.timur, 3, 'pending', 49, { media_type: 'voice', answer_text: '' }),
    teamSubmission(2, people.olga, 4, 'pending', 1.6, { answer_text: 'Разобрала встречу: человек спрашивал про цену и про то, сколько времени это занимает. Про время ответила уверенно, про цену — нет.' }),
    teamSubmission(3, people.aliya, 2, 'pending', 0.4, { answer_text: 'Составила список: 23 человека. Отметила тех, с кем общаюсь чаще всего.' }),
    teamSubmission(4, people.dana, 1, 'pending', 0.2, { media_type: 'photo' }),
    teamSubmission(5, people.ruslan, 5, 'accepted', 30), teamSubmission(6, people.ruslan, 4, 'accepted', 80), teamSubmission(7, people.olga, 3, 'accepted', 60),
    teamSubmission(8, people.timur, 2, 'accepted', 90), teamSubmission(9, people.aliya, 1, 'accepted', 140), teamSubmission(10, people.aigerim, 0, 'accepted', 100),
    teamSubmission(11, people.erlan, 0, 'accepted', 26), teamSubmission(12, people.dana, 0, 'accepted', 150),
  ] },
};

function mentorApi() {
  const json = (body, status = 200) => ({ status, body: { ok: status < 400, ...body } });
  return (method, url) => {
    const key = method + ' ' + url.pathname;
    if (key === 'GET /api/auth/session') return json({ user: mentorUser, session: 'demo', devAuthMode: false });
    if (key === 'GET /api/users') return json({ users: team });
    if (key === 'GET /api/network') return json({ users: team });
    if (key === 'GET /api/tasks') return json(mentor.tasks);
    if (key === 'GET /api/programs') return json(mentor.programs);
    if (key === 'GET /api/submissions') return url.searchParams.get('summary') ? json({ counts: { pending: 4, accepted: 8, requests: 0 } }) : json(mentor.submissions);
    if (key === 'GET /api/announcements') return json(member.announcements);
    if (key === 'GET /api/stars') return json({ awards: [] });
    if (key === 'GET /api/contacts') return json({ contacts: [] });
    if (key === 'GET /api/review-templates') return json({ templates: [], canEdit: true });
    if (key === 'GET /api/welcome-video') return json({ required: false });
    if (key === 'GET /api/feedback') return json({ counts: { unread: 3, needsReply: 3 }, threads: [], groups: [] });
    if (key === 'GET /api/events') return { status: 204, body: null };
    if (process.env.LANDING_SHOTS_DEBUG) console.log('no fixture for ' + key + url.search);
    return json({});
  };
}

async function mentorShots(browser) {
  for (const [name, viewport] of [['mentor-review', { width: 1280, height: 820 }], ['mentor-review-phone', PHONE]]) {
    if (!wants(name)) continue;
    const { page, problems, close } = await open(browser, mentorApi(), viewport);
    await page.goto(base + '/admin?section=review', { waitUntil: 'load' });
    await page.getByText(people.timur.name).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1200);
    await save(name, page);
    await close();
    if (problems.length) throw new Error('The mentor screens had errors: ' + problems.join('; '));
  }
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ channel: process.env.LANDING_SHOTS_CHANNEL || 'chrome', headless: true });
  try {
    await memberShots(browser);
    await mentorShots(browser);
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
