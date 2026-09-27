// Isolated browser checks. All APIs and Telegram links are mocked, no real writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PROKACHKA_PLAYWRIGHT_MODULE || 'playwright');
const artifacts = process.env.PROKACHKA_UI_ARTIFACT_DIR;
if (!artifacts) throw new Error('Set a temporary PROKACHKA_UI_ARTIFACT_DIR');
fs.mkdirSync(artifacts, { recursive: true });
const base = process.env.PROKACHKA_UI_BASE || 'http://localhost:3107', title = 'Капитан ищет свой круиз';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const keys = [0,2,1,1,2,-1,-1,1,1,1,2,1,1,1,0], weights = [2,1,1,1,1,1,2,1,1,1,1,1,1,3,1];
(async () => {
  // Production rejects localhost Host. Resolve its allowed hostname locally,
  // inside this browser only, keeping every API and Telegram interaction mocked.
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: new URL(base).hostname === 'prokachka.kz' ? ['--host-resolver-rules=MAP prokachka.kz 127.0.0.1', '--no-proxy-server'] : [] });
  try {
    // Optional visual comparison against the user's original, never a real booking.
    if (process.env.PROKACHKA_CAPTAIN_REFERENCE) {
      const reference = await browser.newContext({ viewport: { width: 375, height: 820 } });
      await reference.route('**/*', route => route.request().url().startsWith('file:') ? route.continue() : route.abort());
      const sourcePage = await reference.newPage();
      await sourcePage.goto(require('node:url').pathToFileURL(process.env.PROKACHKA_CAPTAIN_REFERENCE).href);
      for (const name of ['intro','home','search','lines','dest','card','cruise','guests','cabin','twist']) {
        await sourcePage.evaluate(name => { S.screen = name; S.dir = 'Европа'; S.phase = 3; S.miles = 19; render(); }, name);
        await sourcePage.screenshot({ path: path.join(artifacts, 'original-'+name+'-375.png'), fullPage: true });
      }
      await reference.close();
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, hasTouch: true });
    let attempt = { index: 0, failed: false, trainingDone: false, screenshotSent: false, trainingPoints: 0, earnedPoints: 0, direction: '' }, linked = false;
    const submissions = [], visits = [], errors = [], actions = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://t.me' && url.pathname === '/fixture_bot') { visits.push(url.searchParams.get('start')); return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>Fake Telegram</h1>' }); }
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/auth/session') return json(200, { user: { id: id(100), name: 'Участник Тест', role: 'member', teamId: id(200), parentUserId: id(300), telegramId: linked ? '111' : undefined } });
      if (url.pathname === '/api/tasks') return json(200, { tasks: [{ id: id(1), title, description: 'Поиск круиза, 19 + 1 миля.', team_id: id(200), is_active: true, publication_type: 'evergreen', interactive_kind: 'captain-cruise', max_points: 20, created_at: '2026-09-27T10:00:00Z' }] });
      if (url.pathname === '/api/submissions') return json(200, { submissions });
      if (url.pathname === '/api/telegram/link') { linked = true; return json(200, { linked: false, url: 'https://t.me/fixture_bot?start=link_fixture' }); }
      if (url.pathname.includes('/ready-programs/') && url.pathname.endsWith('/attempt')) {
        const body = route.request().postDataJSON(); assert.equal(body.action, 'captain'); actions.push(body.operation);
        if (body.operation === 'checkpoint') {
          assert.equal(body.index, attempt.index); assert.equal(attempt.failed, false);
          const correct = keys[body.index] < 0 || body.payload.answer === keys[body.index];
          attempt.lastAnswer = body.payload.answer; attempt.failed = !correct;
          if (correct) { attempt.index++; attempt.trainingPoints += weights[body.index]; if (body.payload.direction) attempt.direction = body.payload.direction; if (body.payload.guests) attempt.guests = body.payload.guests; }
        }
        if (body.operation === 'retry') attempt.failed = false;
        if (body.operation === 'finish') { assert.equal(attempt.index, 15); assert.equal(submissions.length, 0); const s = { id: id(10), user_id: id(100), task_id: id(1), points: 19, status: 'accepted', submission_source: 'interactive', interactive_completed: false, created_at: new Date().toISOString() }; submissions.push(s); attempt = { ...attempt, trainingDone: true, earnedPoints: 19, submission: s }; }
        if (['save-details','telegram-link'].includes(body.operation)) attempt.details = body.payload.details;
        if (body.operation === 'telegram-link') return linked ? json(200, { url: 'https://t.me/fixture_bot?start=captain_fixture' }) : json(422, { message: 'Сначала привяжите свой Telegram.' });
        return json(200, { attempt });
      }
      if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      return json(200, { required: false, users: [], ranking: [], programs: [], submissions, announcements: [], awards: [], starAwards: [] });
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    const button = name => page.getByRole('button', { name, exact: true });
    const open = async () => { await page.goto(base); try { await page.getByRole('button', { name: /Задания$/ }).click(); } catch (error) { console.error((await page.locator('body').innerText()).slice(0,3000), errors); throw error; } await button(title).click(); };
    const layouts = async stage => {
      for (const width of [320,375,430,768,1440]) {
        await page.setViewportSize({ width, height: width < 600 ? 820 : 1050 });
        assert.equal(await page.locator('[data-modal-scroll]').evaluate(node => node.scrollWidth > node.clientWidth + 1), false, `${stage}: ${width} horizontal overflow`);
        await page.screenshot({ path: path.join(artifacts, `${stage}-${width}.png`) });
      }
    };
    const simulator = page.locator('[data-captain-screen]');
    const screen = async value => { await page.locator('[data-captain-screen="'+value+'"]').waitFor(); };
    const quiz = async index => { await page.locator('button[aria-pressed]').nth(keys[index]).click(); await button('Дальше →').click(); };
    await open(); await layouts('captain-intro'); await button('Начать тренировку').click();
    assert.equal(await simulator.getByRole('heading', {name:'Твоё имя'}).evaluate(node => getComputedStyle(node).fontSize), '19px');
    assert.equal(await simulator.getByRole('heading', {name:'Твоё имя'}).evaluate(node => getComputedStyle(node).fontFamily.includes('Manrope')), false);
    await button(/Забронировать отель/).click(); assert.equal(attempt.index, 0); assert.equal(actions.includes('retry'), false); await layouts('captain-home');
    await button(/Забронировать круиз/).click();
    await page.locator('button[aria-pressed]').nth(0).click();
    await page.getByRole('alert').filter({ hasText: 'Не совсем' }).waitFor(); assert.equal(attempt.index, 1); assert.equal(actions.includes('retry'), false);
    await layouts('captain-wrong'); await button('Попробовать ещё раз').click(); await quiz(1);
    await screen('search'); await layouts('captain-search');
    await button('Поиск').click(); await screen('search'); assert.equal(attempt.index, 2);
    await button('Круизная линия').click(); await screen('lines'); await layouts('captain-lines');
    assert.equal(await simulator.locator('button').filter({ hasText: /ⓘ/ }).count(), 14);
    await button(/Disney Cruise Line/).click(); await page.getByRole('status').filter({hasText:'герои Disney'}).waitFor();
    await button('Я посчитал(а) →').click(); for (const index of [2,3,4]) await quiz(index);
    await button('Круизное направление').click(); await screen('dest'); await layouts('captain-directions');
    await page.getByRole('searchbox').fill('Европа'); assert.equal(await simulator.locator('button').filter({ hasText: /^Европа$/ }).count(), 1);
    await button('Европа').click(); await button('Поиск').click(); await screen('card');
    await button('7 Nights Western Mediterranean From Civitavecchia (Rome)').click(); assert.equal(attempt.index, 6);
    const rows = simulator.locator('button[class*="info"],button[class*="price"]');
    assert.equal(await rows.count(), 6);
    for (let j = 0; j < 6; j++) await rows.nth(j).click();
    await page.getByRole('button', {name:'7 Nights Western Mediterranean From Civitavecchia (Rome)', exact:true}).waitFor();
    await layouts('captain-card');
    await button('7 Nights Western Mediterranean From Civitavecchia (Rome)').click(); await quiz(7); await quiz(8); await screen('cruise');
    await button('Book Cruise').click(); await screen('cruise'); assert.equal(attempt.index, 9); await layouts('captain-cruise');
    const categories = simulator.locator('button[class*="cat"]');
    for (let j = 0; j < 4; j++) await categories.nth(j).click();
    await quiz(9); await button('Проверь себя').click(); await quiz(10); await button('Book Cruise').click(); await screen('guests');
    await button('Добавить: Дети и подростки').click(); await button('Добавить: Дети и подростки').click(); await layouts('captain-guests');
    await button('Продолжить →').click(); await quiz(11); await quiz(12); await screen('cabin'); await quiz(13); await layouts('captain-cabin');
    assert.equal(submissions.length, 0);
    await button(/Deluxe Ocean View/).click(); await screen('twist');
    await page.getByText('19 ✈️ миль', {exact:true}).waitFor(); assert.equal(attempt.trainingPoints, 19); assert.equal(submissions.length, 1); await layouts('captain-final');
    await page.getByLabel('Круизная линия', { exact: true }).fill('MSC Cruises'); await page.getByLabel('Цена за всех', { exact: true }).fill('$5,564.48');
    await button('📤 Отправить наставнику · +1 миля').click(); await button('Привязать Telegram').waitFor();
    await button('Привязать Telegram').click(); await page.getByRole('heading', { name: 'Fake Telegram' }).waitFor();
    assert.equal(attempt.earnedPoints, 19); await open();
    assert.equal(await page.getByLabel('Круизная линия', { exact: true }).inputValue(), 'MSC Cruises');
    await button('📤 Отправить наставнику · +1 миля').click(); await page.getByRole('heading', { name: 'Fake Telegram' }).waitFor();
    assert.deepEqual(visits, ['link_fixture','captain_fixture']); assert.equal(submissions.length, 1); assert.equal(submissions[0].points, 19);
    attempt.screenshotSent = true; attempt.earnedPoints = 20; submissions[0].points = 20; submissions[0].interactive_completed = true;
    await open(); await page.getByText('20 ✈️ миль', { exact: true }).waitFor(); assert.equal(await button('📤 Отправить наставнику · +1 миля').count(), 0);
    assert.deepEqual(errors, []); console.log('Captain UI: original simulator screens, gated practice, manual retry, 5 widths, resume, Telegram linking and 19+1 passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
