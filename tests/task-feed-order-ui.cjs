// Isolated browser QA: all API calls are mocked, no production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PROKACHKA_PLAYWRIGHT_MODULE || 'playwright');
const artifacts = process.env.PROKACHKA_UI_ARTIFACT_DIR;
if (!artifacts) throw new Error('Set a temporary PROKACHKA_UI_ARTIFACT_DIR');
fs.mkdirSync(artifacts, { recursive: true });
const base = 'http://127.0.0.1:3107';
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const original = ['Добро пожаловать', 'Правила клуба', 'Мечта с планом', 'Знакомство с наставником', 'Ваш следующий шаг: запишите цель на ближайшую неделю'].map((title, index) => ({
  key: index === 2 ? 'game:dream-plan' : id(index + 1), taskId: id(index + 1), title,
  kind: index === 2 ? 'dream-plan' : null, isPinned: index < 2,
  pinnedAt: index < 2 ? '2026-09-20T10:00:00Z' : null, createdAt: '2026-09-20T10:00:00Z', maxPoints: 10, authorName: 'Наставник',
}));
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, hasTouch: true });
    const writes = [], errors = [];
    let items = [...original], version = 1, reads = 0, failNext = 0, customized = false;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/auth/session') return json(200, { user: { id: id(100), name: 'Наставник', role: 'admin', teamId: id(200), telegramId: '123' } });
      if (url.pathname === '/api/tasks/order') {
        if (route.request().method() === 'PUT') {
          const payload = route.request().postDataJSON(); writes.push(payload);
          if (failNext) { const status = failNext; failNext = 0; return json(status, { message: status === 409 ? 'Список изменился. Обновите список.' : 'Не удалось сохранить порядок. Повторите попытку.' }); }
          items = payload.inherit ? [...original] : [...payload.pinned, ...payload.regular].map(key => items.find(item => item.key === key));
          customized = !payload.inherit; version++;
        } else reads++;
        return json(200, { order: { items, scope: 'team', customized, revision: String(version).padStart(32, '0') } });
      }
      if (url.pathname === '/api/tasks') return json(200, { tasks: items.map((item, index) => ({ id: item.taskId, title: item.title, is_active: true, is_pinned: item.isPinned, pinned_at: item.pinnedAt, publication_type: 'evergreen', interactive_kind: item.kind, max_points: 10, created_at: item.createdAt, feed_order: index })) });
      if (url.pathname === '/api/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': test\n\n' });
      return json(200, { users: [], submissions: [], programs: [], readyPrograms: [], announcements: [], awards: [], ranking: [], requests: [], counts: { pending: 0, accepted: 0, requests: 0 }, required: false });
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => { errors.push(error.message); console.error('Page error:', error.message); });
    await page.goto(base + '/admin');
    await page.getByRole('button', { name: /Задания$/ }).click();
    const open = async () => {
      await page.getByRole('button', { name: /Изменить порядок/ }).click();
      await page.locator('[data-order-key]').first().waitFor();
    };
    const keys = () => page.locator('[data-order-key]').evaluateAll(rows => rows.map(row => row.dataset.orderKey));
    await open();
    console.log('Ordering dialog opened.');
    const save = page.getByRole('button', { name: 'Сохранить порядок', exact: true });
    assert.equal(await save.isDisabled(), true);
    for (const width of [320, 375, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 700 ? 812 : 1050 });
      const dimensions = await page.getByRole('dialog').evaluate(dialog => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, width: dialog.clientWidth, scroll: dialog.scrollWidth, body: dialog.querySelector('[data-modal-scroll]').clientWidth, bodyScroll: dialog.querySelector('[data-modal-scroll]').scrollWidth }));
      assert.ok(dimensions.page <= dimensions.viewport && dimensions.scroll <= dimensions.width && dimensions.bodyScroll <= dimensions.body, `Overflow at ${width}: ${JSON.stringify(dimensions)}`);
      await page.screenshot({ path: path.join(artifacts, `task-order-${width}.png`) });
    }
    console.log('Responsive layouts verified.');
    // Arrow and keyboard changes stay local and can be cancelled.
    await page.getByRole('button', { name: 'Ниже: Добро пожаловать', exact: true }).click();
    assert.deepEqual((await keys()).slice(0, 2), [original[1].key, original[0].key]);
    await page.getByRole('button', { name: 'Переместить: Добро пожаловать', exact: true }).press('ArrowUp');
    assert.equal(await save.isDisabled(), true);
    await page.getByRole('button', { name: 'Ниже: Мечта с планом', exact: true }).click();
    assert.equal(writes.length, 0);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await open();
    assert.deepEqual(await keys(), original.map(item => item.key));

    // Actual pointer capture / mouse dragging, including group boundaries.
    const handle = page.getByRole('button', { name: 'Переместить: Мечта с планом', exact: true });
    const source = await handle.boundingBox();
    const target = await page.locator(`[data-order-key="${original[3].key}"]`).boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2, target.y + target.height / 2, { steps: 12 });
    await page.waitForFunction(key => document.querySelectorAll('[data-order-key]')[3]?.getAttribute('data-order-key') === key, original[2].key);
    await page.mouse.up();
    assert.deepEqual((await keys()).slice(2), [original[3].key, original[2].key, original[4].key]);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await open();
    const beforeCross = await keys();
    const firstHandle = await page.getByRole('button', { name: 'Переместить: Добро пожаловать', exact: true }).boundingBox();
    const regular = await handle.boundingBox();
    await page.mouse.move(firstHandle.x + 20, firstHandle.y + 20);
    await page.mouse.down();
    await page.mouse.move(regular.x + 20, regular.y + 20);
    await page.mouse.up();
    assert.deepEqual(await keys(), beforeCross);

    // Conflict keeps the draft; reloading must bypass any client data cache.
    await page.getByRole('button', { name: 'Ниже: Мечта с планом', exact: true }).click();
    failNext = 409;
    await save.click();
    await page.getByRole('alert').waitFor();
    assert.equal(await save.isDisabled(), true);
    const beforeReads = reads;
    await page.getByRole('button', { name: 'Обновить список', exact: true }).click();
    await page.waitForFunction(key => document.querySelectorAll('[data-order-key]')[2]?.getAttribute('data-order-key') === key, original[2].key);
    assert.ok(reads > beforeReads);

    // Touch drag on a phone-sized viewport; no browser emulation of HTML5 DnD.
    await page.setViewportSize({ width: 375, height: 812 });
    await handle.scrollIntoViewIfNeeded();
    const touchStart = await handle.boundingBox();
    const touchTarget = await page.locator(`[data-order-key="${original[3].key}"]`).boundingBox();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchStart.x + 20, y: touchStart.y + 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchStart.x + 20, y: touchTarget.y + touchTarget.height / 2 }] });
    await page.waitForFunction(key => document.querySelectorAll('[data-order-key]')[3]?.getAttribute('data-order-key') === key, original[2].key);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Сохранить порядок' && !button.disabled));
    assert.equal(await save.isDisabled(), false);
    failNext = 500;
    const draft = await keys();
    await save.click();
    await page.getByRole('alert').waitFor();
    assert.deepEqual(await keys(), draft);
    await save.click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(writes.at(-1).regular, draft.slice(2));
    await open();
    assert.deepEqual(await keys(), draft);
    await page.getByRole('button', { name: 'Вернуть порядок по дате публикации и закрепления', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(writes.at(-1).inherit, true);
    assert.deepEqual(errors, []);
    console.log('Task ordering UI passed: five widths, arrows, keyboard, mouse/touch drag, group boundaries, cancel, conflicts/reload, retry, save, reset.');
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(artifacts, 'task-order-failure.png') }); console.error(await page.locator('body').innerText()); }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
