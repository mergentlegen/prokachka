// Browser QA with every API intercepted; no real account, email or DB mutation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PROKACHKA_PLAYWRIGHT_MODULE || 'playwright');
const artifacts = process.env.PROKACHKA_UI_ARTIFACT_DIR;
if (!artifacts) throw new Error('Set a temporary PROKACHKA_UI_ARTIFACT_DIR');
fs.mkdirSync(artifacts, { recursive: true });
const base = 'http://127.0.0.1:3107';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const writes = [], errors = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.fulfill({ response: await route.fetch({ headers: { ...route.request().headers(), host: 'prokachka.kz' } }) });
      return route.continue();
    });
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const payload = route.request().postDataJSON();
      if (route.request().method() !== 'GET') writes.push({ path: url.pathname, payload, cookie: route.request().headers().cookie });
      const json = (status, body, headers = {}) => route.fulfill({ status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      if (url.pathname === '/api/auth/password/request') return json(202, { recoveryRequested: true, email: payload.email, resendAfter: 60 });
      if (url.pathname === '/api/auth/password/verify') {
        return payload.code === '012345' ? json(200, { recoveryVerified: true, expiresIn: 600 }, {
          'set-cookie': 'prokachka_password_recovery=' + 'A'.repeat(43) + '; Path=/api/auth/password; HttpOnly; SameSite=Strict',
        }) : json(400, { message: 'Код неверный или срок его действия истёк.' });
      }
      if (url.pathname === '/api/auth/password/reset') {
        if (payload.password === 'weak-password') return json(400, { message: 'Этот пароль слишком простой. Выберите другой пароль.' });
        return json(200, { passwordReset: true }, { 'set-cookie': 'prokachka_password_recovery=; Path=/api/auth/password; HttpOnly; Max-Age=0' });
      }
      if (url.pathname === '/api/auth/session') return json(401, { message: 'No fixture session' });
      return json(200, {});
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.getByLabel('Email', { exact: true }).fill('person@example.com');
    await page.getByRole('button', { name: 'Забыли пароль?' }).click();
    await page.getByRole('heading', { name: 'Восстановить пароль' }).waitFor();
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'person@example.com');
    async function layouts(stage) {
      for (const width of [320, 375, 390, 430, 768, 1440]) {
        await page.setViewportSize({ width, height: width > 700 ? 900 : 812 });
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(dimensions.scroll <= dimensions.viewport, `Overflow: ${stage}/${width}`);
        await page.screenshot({ path: path.join(artifacts, `password-${stage}-${width}.png`) });
      }
      await page.setViewportSize({ width: 375, height: 812 });
    }
    await layouts('email');
    await page.getByRole('button', { name: 'Отправить код', exact: true }).click();
    await page.getByRole('heading', { name: 'Проверьте почту' }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Отправить код повторно/ }).isDisabled(), true);
    await layouts('code');
    await page.getByLabel('Код из письма').fill('111111');
    await page.getByRole('button', { name: 'Подтвердить код' }).click();
    await page.getByRole('alert').filter({ hasText: 'Код неверный' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Проверьте почту' }).waitFor();
    assert.equal(await page.getByLabel('Код из письма').inputValue(), '');
    await page.getByLabel('Код из письма').fill('012345');
    await page.getByRole('button', { name: 'Подтвердить код' }).click();
    await page.getByRole('heading', { name: 'Новый пароль' }).waitFor();
    const store = await page.evaluate(() => sessionStorage.getItem('prokachka-password-recovery'));
    assert.ok(!store.includes('012345') && !store.includes('token'));
    await layouts('password');
    await page.getByLabel('Новый пароль', { exact: true }).fill('new-password');
    await page.getByLabel('Повторите новый пароль', { exact: true }).fill('mismatch');
    await page.getByRole('button', { name: 'Сохранить новый пароль' }).click();
    await page.getByRole('alert').filter({ hasText: 'Пароли не совпадают' }).waitFor();
    assert.equal(writes.filter(item => item.path.endsWith('/reset')).length, 0);
    await page.reload();
    await page.getByRole('heading', { name: 'Новый пароль' }).waitFor();
    assert.equal(await page.getByLabel('Новый пароль', { exact: true }).inputValue(), '');
    for (const value of ['weak-password', 'new-password']) {
      await page.getByLabel('Новый пароль', { exact: true }).fill(value);
      await page.getByLabel('Повторите новый пароль', { exact: true }).fill(value);
      await page.getByRole('button', { name: 'Сохранить новый пароль' }).click();
      if (value === 'weak-password') await page.getByRole('alert').filter({ hasText: 'слишком простой' }).waitFor();
    }
    await page.getByRole('heading', { name: 'Войти в аккаунт' }).waitFor();
    await page.getByRole('status').filter({ hasText: 'Пароль изменён' }).waitFor();
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'person@example.com');
    assert.equal(await page.getByLabel('Пароль', { exact: true }).inputValue(), '');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('prokachka-password-recovery')), null);
    assert.ok(writes.filter(item => item.path.endsWith('/reset')).every(item => item.cookie?.includes('prokachka_password_recovery=')));
    assert.deepEqual(errors, []);
    console.log('Password recovery UI passed: email/code/password, mobile widths, bad code, reload, mismatch, policy retry, HttpOnly cookie, return to login.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
