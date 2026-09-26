// Optional browser QA. Every API and external request is intercepted; no real
// account, SMTP message, or database write is performed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PROKACHKA_PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:3107';
const artifacts = process.env.PROKACHKA_UI_ARTIFACT_DIR;
if (!artifacts) throw new Error('Set a temporary PROKACHKA_UI_ARTIFACT_DIR');
fs.mkdirSync(artifacts, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 });
    const writes = [], errors = [];
    let confirmed = false, email = 'anna@example.com';
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      // Production Host allowlist remains intact; only this loopback test fetch
      // supplies the legitimate host. All API calls still use fixtures below.
      if (!url.pathname.startsWith('/api/')) return route.fulfill({ response: await route.fetch({ headers: { ...route.request().headers(), host: 'prokachka.kz' } }) });
      const payload = route.request().postDataJSON();
      const json = (status, body, headers = {}) => route.fulfill({ status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      if (route.request().method() !== 'GET') writes.push({ path: url.pathname, payload });
      if (url.pathname === '/api/auth/register') {
        email = payload.email.trim().toLowerCase();
        return json(202, { ok: true, verificationRequired: true, email, resendAfter: 60 });
      }
      if (url.pathname === '/api/auth/verify-email') {
        if (payload.code !== '012345') return json(400, { ok: false, message: 'Код неверный или срок его действия истёк.' });
        confirmed = true;
        return json(200, { ok: true, user: { id: 'fixture-user', name: 'Анна Участница', role: 'member', login: email } });
      }
      if (url.pathname === '/api/auth/resend-email') return json(202, { ok: true, verificationRequired: true, email, resendAfter: 60 });
      if (url.pathname === '/api/auth/login') {
        if (!confirmed) return json(202, { ok: true, verificationRequired: true, email, resendAfter: 0 });
        return json(200, { ok: true, user: { id: 'fixture-user', name: 'Анна Участница', role: 'member', login: email } });
      }
      if (url.pathname === '/api/auth/session') return json(401, { ok: false, message: 'No fixture session' });
      if (url.pathname === '/api/team-requests') return json(200, { requests: [] });
      if (url.pathname === '/api/teams') return json(200, { teams: [] });
      return json(200, {});
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/?invite=abcdefghijklmnopqrstuvwx');
    await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
    await page.getByLabel('Имя', { exact: true }).fill('Анна');
    await page.getByLabel('Фамилия', { exact: true }).fill('Участница');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Пароль', { exact: true }).fill('secret-password');
    await page.getByLabel('Повторите пароль', { exact: true }).fill('secret-password');
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await page.getByRole('heading', { name: 'Подтвердите почту' }).waitFor();
    assert.equal(writes[0].payload.inviteToken, 'abcdefghijklmnopqrstuvwx');
    const stored = await page.evaluate(() => sessionStorage.getItem('prokachka-pending-email'));
    assert.ok(stored.includes(email)); assert.ok(!stored.includes('secret-password'));
    assert.match(await page.getByRole('button', { name: /Отправить код повторно/ }).innerText(), /через \d+ с/);
    for (const width of [320, 375, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: width > 700 ? 900 : 812 });
      const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, input: document.querySelector('[name=code]').getBoundingClientRect().width }));
      assert.ok(layout.scroll <= layout.width, `Overflow at ${width}: ${JSON.stringify(layout)}`);
      await page.screenshot({ path: path.join(artifacts, `email-code-${width}.png`) });
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByLabel('Код из письма').fill('111111');
    await page.getByRole('button', { name: 'Подтвердить почту', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Код неверный' }).waitFor();
    assert.equal(confirmed, false);
    await page.reload();
    await page.getByRole('heading', { name: 'Подтвердите почту' }).waitFor();
    await page.getByRole('button', { name: 'Изменить почту или вернуться ко входу' }).click();
    await page.getByRole('heading', { name: 'Войти в аккаунт' }).waitFor();
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), email);
    await page.getByLabel('Пароль', { exact: true }).fill('secret-password');
    await page.locator('button[type=submit]').filter({ hasText: 'Войти' }).click();
    await page.getByRole('heading', { name: 'Подтвердите почту' }).waitFor();
    await page.getByRole('button', { name: 'Отправить код повторно', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Новый код отправлен' }).waitFor();
    await page.getByLabel('Код из письма').fill('012345');
    await page.getByRole('button', { name: 'Подтвердить почту', exact: true }).click();
    await page.getByRole('heading', { name: /Выберите свою команду/ }).waitFor();
    assert.equal(confirmed, true);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('prokachka-pending-email')), null);
    assert.equal(writes.filter(item => item.path === '/api/auth/verify-email').length, 2);
    assert.equal(writes.find(item => item.path === '/api/auth/verify-email').payload.email, email);
    assert.deepEqual(errors, []);
    console.log(`Email UI QA passed: registration, invitation, mobile widths, error, reload, resend, leading-zero OTP, completion. Screenshots: ${artifacts}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
