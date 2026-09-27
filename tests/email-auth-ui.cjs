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
    await page.getByRole('heading', { name: 'Войти в аккаунт' }).waitFor();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width > 700 ? 900 : 812 });
      const layout = await page.evaluate(() => {
        const bounds = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { width: innerWidth, scroll: document.documentElement.scrollWidth, email: bounds('[name=email]'), password: bounds('[name=password]'), submit: bounds('button[type=submit]') };
      });
      assert.ok(layout.scroll <= layout.width, `Login overflow at ${width}`);
      assert.equal(layout.email.height, layout.password.height, 'inputs retain a consistent height');
      assert.equal(layout.email.x, layout.password.x, 'inputs share the same left edge');
      const forgot = await page.getByRole('button', { name: 'Забыли пароль?' }).boundingBox();
      assert.ok(forgot.y + forgot.height <= layout.password.y, 'recovery action stays beside the password label');
      const register = await page.getByRole('button', { name: 'Зарегистрируйтесь' }).boundingBox();
      assert.ok(register.y >= layout.submit.bottom, 'registration prompt follows the primary action');
      await page.screenshot({ path: path.join(artifacts, `login-${width}.png`), fullPage: true });
    }
    await page.getByLabel('Пароль', { exact: true }).fill('temporary-password');
    await page.getByRole('button', { name: 'Показать пароль', exact: true }).click();
    assert.equal(await page.locator('[name=password]').getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Скрыть пароль', exact: true }).click();
    assert.equal(await page.locator('[name=password]').getAttribute('type'), 'password');
    await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
    for (const invalidName of ['firstName', 'lastName']) {
      await page.locator('[name=firstName]').fill('Анна');
      await page.locator('[name=lastName]').fill('Участница');
      await page.locator(`[name=${invalidName}]`).fill('a');
      await page.getByLabel('Email', { exact: true }).focus();
      await page.locator(`#auth-${invalidName}-error`).waitFor();
      for (const width of [320, 375, 390, 430, 520, 521, 768, 1440]) {
        await page.setViewportSize({ width, height: width > 700 ? 900 : 812 });
        const layout = await page.evaluate(() => {
          const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
          return { width: innerWidth, scroll: document.documentElement.scrollWidth, first: rect('[name=firstName]'), last: rect('[name=lastName]'), email: rect('[name=email]') };
        });
        assert.ok(layout.scroll <= layout.width, `Registration overflow at ${width}`);
        assert.equal(layout.first.height, layout.last.height, `An error must not stretch its neighbour at ${width}`);
        assert.equal(layout.first.height, layout.email.height, 'All input heights remain equal');
        if (width > 520) assert.equal(layout.first.y, layout.last.y, `Name inputs must align despite ${invalidName} error at ${width}`);
        else {
          assert.equal(layout.first.x, layout.last.x, 'Phone name fields use one column');
          assert.ok(layout.last.top >= layout.first.bottom, 'Name inputs must not overlap');
        }
        if ([320, 390, 1440].includes(width)) await page.screenshot({ path: path.join(artifacts, `registration-${invalidName}-error-${width}.png`), fullPage: true });
      }
    }
    assert.equal(writes.length, 0, 'Layout and local validation must not submit accounts');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByLabel('Имя', { exact: true }).fill('Анна');
    await page.getByLabel('Фамилия', { exact: true }).fill('Участница');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Пароль', { exact: true }).fill('Secret-password1');
    await page.getByLabel('Повторите пароль', { exact: true }).fill('Secret-password1');
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await page.getByRole('heading', { name: 'Подтвердите почту' }).waitFor();
    assert.equal(writes[0].payload.inviteToken, 'abcdefghijklmnopqrstuvwx');
    const stored = await page.evaluate(() => sessionStorage.getItem('prokachka-pending-email'));
    assert.ok(stored.includes(email)); assert.ok(!stored.includes('Secret-password1'));
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
    await page.getByLabel('Пароль', { exact: true }).fill('Secret-password1');
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
    console.log(`Email UI QA passed: login layout, password visibility, registration field alignment with errors, invitation, mobile widths, OTP error, reload, resend, leading-zero OTP, completion. Screenshots: ${artifacts}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
