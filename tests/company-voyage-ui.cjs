// Opt-in isolated browser QA. All API/external requests intercepted: no real writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PROKACHKA_PLAYWRIGHT_MODULE || 'playwright');
const artifacts = process.env.PROKACHKA_UI_ARTIFACT_DIR;
if (!artifacts) throw new Error('Set a temporary PROKACHKA_UI_ARTIFACT_DIR');
fs.mkdirSync(artifacts, { recursive: true });
const base = 'http://127.0.0.1:3107';
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const title = 'Корабль, на который ты поднялся';
const answers = [1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1];
const labels = ['Правда','Миф','Не совсем так'];
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, hasTouch: true });
    let attempt = { attemptId: id(9), step: 0, status: 'active', attemptNumber: 1, earnedPoints: 0, maxPoints: 10, questionIndex: 0, answeredQuestions: 0, completed: false, ready: false, failed: false };
    const errors = [], actions = [], submissions = [], telegramVisits = [];
    let voiceLinked = false;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://t.me' && url.pathname === '/fixture_bot') {
        telegramVisits.push(url.searchParams.get('start'));
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<h1>Fake Telegram</h1>' });
      }
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/auth/session') return json(200, { user: { id: id(100), name: 'Участник Тест', role: 'member', teamId: id(200), parentUserId: id(300), telegramId: '123' } });
      if (url.pathname === '/api/tasks') return json(200, { tasks: [{ id: id(1), title, description: 'Восемь карточек, 17 вопросов и свой рассказ.', team_id: id(200), is_active: true, publication_type: 'evergreen', interactive_kind: 'company-voyage', max_points: 10, created_at: '2026-09-27T10:00:00Z' }] });
      if (url.pathname === '/api/submissions') return json(200, { submissions });
      if (url.pathname === '/api/telegram/link') { voiceLinked = true; return json(200, { linked: false, url: 'https://t.me/fixture_bot?start=link_fixture' }); }
      if (url.pathname.includes('/ready-programs/') && url.pathname.endsWith('/attempt')) {
        const body = route.request().postDataJSON(); actions.push(body.action);
        if (body.action === 'voice-link') return voiceLinked ? json(200, { url: 'https://t.me/fixture_bot?start=company_voice_fixture' }) : json(422, { message: 'Сначала привяжите свой Telegram.' });
        if (body.action === 'advance') { assert.equal(body.step, attempt.step + 1); attempt.step = body.step; }
        if (body.action === 'answer') {
          assert.equal(body.questionIndex, attempt.questionIndex); assert.equal(attempt.failed, false);
          attempt.lastAnswer = body.answer; attempt.failed = body.answer !== answers[attempt.questionIndex];
          if (!attempt.failed) attempt.questionIndex++;
          attempt.answeredQuestions = attempt.questionIndex; attempt.ready = attempt.questionIndex === 17;
        }
        if (body.action === 'restart-quiz') { assert.equal(attempt.failed, true); attempt = { ...attempt, failed: false, questionIndex: 0, answeredQuestions: 0, lastAnswer: null, attemptNumber: 2 }; }
        if (body.action === 'complete') {
          assert.equal(attempt.ready, true); assert.equal(submissions.length, 0);
          const submission = { id: id(10), user_id: id(100), task_id: id(1), status: 'accepted', points: 10, submission_source: 'interactive', created_at: new Date().toISOString() };
          submissions.push(submission); attempt = { ...attempt, status: 'completed', completed: true, earnedPoints: 10, submission };
        }
        if (body.action === 'save-story') { assert.equal(attempt.completed, true); attempt.storyChoices = body.choices; }
        return json(200, { attempt });
      }
      if (url.pathname === '/api/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': test\n\n' });
      return json(200, { required: false, users: [], ranking: [], programs: [], submissions, announcements: [], awards: [], starAwards: [] });
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.getByRole('button', { name: /Задания$/ }).click();
    await page.getByRole('button', { name: 'Начать игру', exact: true }).click();
    const open = () => page.getByRole('button', { name: title, exact: true }).click();
    const close = () => page.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
    const button = name => page.getByRole('button', { name, exact: true });
    const checkLayouts = async stage => {
      for (const width of [320,375,430,768,1440]) {
        await page.setViewportSize({ width, height: width < 700 ? 812 : 1050 });
        const dims = await page.getByRole('dialog').evaluate(dialog => {
          const body = dialog.querySelector('[data-modal-scroll]');
          return { page: document.documentElement.scrollWidth, viewport: innerWidth, width: body.clientWidth, scroll: body.scrollWidth };
        });
        assert.ok(dims.page <= dims.viewport && dims.scroll <= dims.width, `${stage} overflow at ${width}: ${JSON.stringify(dims)}`);
        await page.screenshot({ path: path.join(artifacts, `company-${stage}-${width}.png`) });
      }
      await page.setViewportSize({ width: 375, height: 812 });
    };
    await button('Поднимаюсь на борт →').waitFor();
    await checkLayouts('intro'); await button('Поднимаюсь на борт →').click();
    await checkLayouts('cards');
    for (let card = 0; card < 7; card++) await button('Следующая карточка →').click();
    await button('Начать тест →').click();
    await checkLayouts('quiz');
    await button('Правда').click();
    await page.getByText('Этот ответ неверный', { exact: true }).waitFor();
    assert.equal(actions.includes('restart-quiz'), false);
    assert.equal(await page.locator('button[aria-pressed="true"]').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 240, 242)');
    await checkLayouts('failure'); await close(); await open();
    await button('Пройти заново').waitFor(); assert.equal(actions.includes('restart-quiz'), false);
    await button('Пройти заново').click();
    for (const [index, answer] of answers.entries()) {
      // Decorative symbols are aria-hidden, so the accessible name is just the option.
      await page.locator('button[aria-pressed]').filter({ hasText: labels[answer] }).click();
      await page.getByText('Верно!', { exact: true }).waitFor();
      if (index < 16) await button('Следующий вопрос →').click();
    }
    assert.equal(submissions.length, 0);
    await button('Завершить и получить 10 миль').click();
    await page.getByRole('heading', { name: 'Теперь у тебя есть ответы' }).waitFor();
    await checkLayouts('result');
    await button('Собрать мой рассказ →').click();
    for (const group of await page.locator('fieldset').all()) await group.getByRole('radio').last().check();
    await checkLayouts('story');
    await button('Сохранить план рассказа').click();
    await page.getByText('План рассказа сохранён.', { exact: false }).waitFor();
    assert.deepEqual(attempt.storyChoices, [2,4,2]);
    await close(); await open(); await button('Собрать мой рассказ →').click();
    assert.equal(await page.getByRole('radio', { checked: true }).count(), 3);
    assert.equal(submissions.length, 1); assert.equal(submissions[0].points, 10);
    assert.equal(actions.filter(action => action === 'complete').length, 1);
    await button('Отправить голосовое наставнику').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, 'company-voice-button-375.png') });
    await button('Отправить голосовое наставнику').click();
    await button('Привязать Telegram').waitFor();
    assert.deepEqual(attempt.storyChoices, [2,4,2]); assert.equal(submissions.length, 1);
    await button('Привязать Telegram').click();
    await page.getByRole('heading', { name: 'Fake Telegram' }).waitFor();
    assert.deepEqual(telegramVisits, ['link_fixture']);
    await page.goto(base); await page.getByRole('button', { name: /Задания$/ }).click();
    await open(); await button('Собрать мой рассказ →').click();
    await button('Отправить голосовое наставнику').click();
    await page.getByRole('heading', { name: 'Fake Telegram' }).waitFor();
    assert.deepEqual(telegramVisits, ['link_fixture','company_voice_fixture']);
    assert.equal(submissions.length, 1); assert.equal(submissions[0].points, 10);
    assert.deepEqual(errors, []);
    console.log('Company game: five widths, quiz/reward, saved story, Telegram linking and voice deep link passed (no external writes).');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
