// Optional browser QA against local UI fixtures, never a real database.
// PROKACHKA_PLAYWRIGHT_MODULE points to an installed Playwright package.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { chromium } = require(process.env.PROKACHKA_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PROKACHKA_UI_BASE || 'http://127.0.0.1:3106';
if (!/^http:\/\/(127\.0\.0\.1|localhost):3106$/.test(base)) throw new Error('Profile UI QA requires isolated localhost fixtures on 3106');
const artifacts = process.env.PROKACHKA_UI_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'prokachka-profile-ui-'));
fs.mkdirSync(artifacts, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PROKACHKA_BROWSER_CHANNEL || 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/profile') writes.push(request); });
    await page.goto(base);
    await page.getByRole('button', { name: 'Открыть профиль', exact: true }).click();
    await page.getByRole('button', { name: 'Редактировать профиль', exact: true }).click();
    await page.getByLabel('Имя', { exact: true }).fill('Александра');
    await page.getByLabel('Фамилия', { exact: true }).fill('Ибрагимова');
    assert.equal(await page.getByRole('dialog').locator('input[type=email]').count(), 0);
    for (const width of [320, 375, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: width > 700 ? 900 : 812 });
      const layout = await page.getByRole('dialog').evaluate(dialog => ({ width: dialog.clientWidth, scroll: dialog.scrollWidth, form: dialog.querySelector('form').scrollWidth, available: dialog.querySelector('form').clientWidth }));
      assert.ok(layout.scroll <= layout.width + 1 && layout.form <= layout.available + 1, `Profile editor overflow at ${width}: ${JSON.stringify(layout)}`);
      await page.screenshot({ path: path.join(artifacts, `editor-${width}.png`) });
    }
    await page.setViewportSize({ width: 375, height: 812 });
    const photo = await sharp({ create: { width: 960, height: 640, channels: 3, background: '#28a6a5' } }).composite([
      { input: await sharp({ create: { width: 480, height: 320, channels: 3, background: '#3255b3' } }).png().toBuffer(), top: 0, left: 0 },
      { input: await sharp({ create: { width: 480, height: 320, channels: 3, background: '#f7b330' } }).png().toBuffer(), top: 320, left: 480 },
    ]).jpeg().withMetadata({ orientation: 1 }).toBuffer();
    await page.locator('input[type=file]').setInputFiles({ name: 'camera.jpg', mimeType: 'image/jpeg', buffer: photo });
    await page.getByRole('img', { name: 'Предпросмотр фотографии' }).waitFor();
    await page.getByLabel('Масштаб', { exact: true }).press('ArrowRight');
    await page.getByLabel('Влево — вправо', { exact: true }).press('ArrowRight');
    await page.screenshot({ path: path.join(artifacts, 'crop-375.png') });
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await page.getByRole('button', { name: 'Редактировать профиль', exact: true }).waitFor();
    assert.equal(writes.length, 1);
    assert.ok(writes[0].postDataBuffer().length < 512 * 1024);
    const profileImage = page.locator('.profile-avatar img');
    await profileImage.waitFor();
    await page.waitForFunction(() => document.querySelector('.profile-avatar img')?.naturalWidth === 512);
    await page.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
    await page.locator('.bottom-nav button').filter({ hasText: 'Рейтинг' }).click();
    await page.locator('.rank-row').filter({ hasText: 'Александра Ибрагимова' }).locator('img').waitFor();

    await page.getByRole('button', { name: 'Открыть профиль', exact: true }).click();
    await page.getByRole('button', { name: 'Редактировать профиль', exact: true }).click();
    await page.getByRole('button', { name: 'Удалить фото', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await page.getByRole('button', { name: 'Редактировать профиль', exact: true }).waitFor();
    assert.equal(await page.locator('.profile-avatar img').count(), 0);
    assert.equal(await page.locator('.profile-avatar').innerText(), 'АИ');
    assert.equal(writes.length, 2);

    await page.getByRole('button', { name: 'Редактировать профиль', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await page.getByRole('alert').filter({ hasText: 'JPG, PNG или WebP' }).waitFor();
    assert.equal(writes.length, 2);
    // Another tab saves first; the editor must keep the user's input on conflict.
    const user = (await (await context.request.get(base + '/api/auth/session', { headers: { referer: base } })).json()).user;
    const other = await context.request.patch(base + '/api/profile', { headers: { referer: base }, multipart: {
      firstName: 'Другое', lastName: 'Имя', avatarAction: 'keep', expectedVersion: user.profileVersion,
    } });
    assert.equal(other.status(), 200);
    await page.getByLabel('Имя', { exact: true }).fill('Александра');
    await page.getByLabel('Фамилия', { exact: true }).fill('Новая');
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await page.getByRole('button', { name: 'Обновить данные', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Фамилия', { exact: true }).inputValue(), 'Новая');
    await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await page.getByRole('button', { name: 'Редактировать профиль', exact: true }).waitFor();

    await page.goto(base + '/admin');
    await page.getByRole('button', { name: 'Открыть профиль', exact: true }).click();
    await page.getByRole('button', { name: 'Редактировать профиль', exact: true }).click();
    assert.equal(await page.getByLabel('Имя', { exact: true }).inputValue(), 'Тестовый');
    await page.screenshot({ path: path.join(artifacts, 'mentor-editor-375.png') });
    assert.deepEqual(errors, []);
    console.log(`Profile browser QA passed: mobile/desktop, crop, save, ranking, removal, validation, conflict, mentor. Screenshots: ${artifacts}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
