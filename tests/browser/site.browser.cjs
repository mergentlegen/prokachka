// Opens the built site in a real Chrome: the landing page, the sign-in form and the participant's feed.
// It catches what unit tests cannot: a script that fails to load, a page that crashes in the browser,
// a Content-Security-Policy that blocks the site's own code.
//
// Nothing here touches production or Supabase. The browser believes it is on https://prokachka.kz, but every
// request is answered by this file: pages and scripts come from the local build (PROKACHKA_BROWSER_URL),
// /api/* answers are the fixtures below, and anything addressed elsewhere is refused.
//
//   PROKACHKA_BROWSER_URL=http://127.0.0.1:3100 npm run test:browser
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const base = process.env.PROKACHKA_BROWSER_URL;
const ORIGIN = 'https://prokachka.kz';
const skip = base ? false : 'set PROKACHKA_BROWSER_URL to a running local build';

const user = { id: '11111111-1111-4111-8111-111111111111', name: 'Алия Бекова', firstName: 'Алия', lastName: 'Бекова',
  email: 'aliya@test.invalid', role: 'member', teamId: '22222222-2222-4222-8222-222222222222', canReview: false,
  emailVerified: true, sessionVersion: 0, createdAt: '2026-01-01T00:00:00.000Z', teamJoinedAt: '2026-01-01T00:00:00.000Z' };
const task = { id: '33333333-3333-4333-8333-333333333333', title: 'Проверочное задание для браузера', description: 'Расскажи о себе в двух предложениях.',
  max_points: 5, is_active: true, is_pinned: false, publication_type: 'evergreen', team_id: user.teamId,
  created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z', attachments: [] };

function fromBuild(pathname, cookie) {
  if (new URL(base).hostname !== '127.0.0.1') throw new Error('The browser test serves pages only from a local build');
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(pathname, base), { headers: { Host: 'prokachka.kz', ...(cookie ? { Cookie: cookie } : {}) }, timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The local build did not answer: ' + pathname)));
    req.on('error', reject);
    req.end();
  });
}

/** One browser tab with its own fake backend; `state` is what the test asserts on afterwards. */
async function openSite(browser) {
  const state = { signedIn: false, logins: [], api: [], refused: [], problems: [] };
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
  const answers = {
    'GET /api/auth/session': (route) => state.signedIn ? json(route, 200, { ok: true, user, session: 'browser-test', devAuthMode: false })
      : json(route, 401, { ok: false, message: 'Сессия не найдена.' }),
    'POST /api/auth/login': (route, request) => {
      state.logins.push(JSON.parse(request.postData() || '{}'));
      state.signedIn = true;
      return json(route, 200, { ok: true, user, session: 'browser-test', devAuthMode: false });
    },
    'GET /api/tasks': (route) => json(route, 200, { ok: true, tasks: [task], programs: [], passedTasks: [] }),
    'GET /api/submissions': (route) => json(route, 200, { ok: true, submissions: [] }),
    'GET /api/ranking': (route) => json(route, 200, { ok: true, ranking: [{ userId: user.id, name: user.name, points: 0, rank: 1 }], starRanking: [], level: 1, levelUp: null }),
    'GET /api/announcements': (route) => json(route, 200, { ok: true, announcements: [] }),
    'GET /api/stars': (route) => json(route, 200, { ok: true, awards: [] }),
    'GET /api/network': (route) => json(route, 200, { ok: true, users: [] }),
    'GET /api/feedback': (route) => json(route, 200, { ok: true, counts: { unread: 0, needsReply: 0 }, threads: [] }),
    // The live-updates stream: an open connection is not needed to draw the page.
    'GET /api/events': (route) => route.fulfill({ status: 204, body: '' }),
  };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', serviceWorkers: 'block' });
  await context.routeWebSocket(/.*/, (socket) => { state.refused.push('websocket ' + socket.url()); socket.close(); });
  await context.route(/.*/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.origin !== ORIGIN) { state.refused.push(request.url()); return route.abort(); }
    if (url.pathname.startsWith('/api/')) {
      const key = request.method() + ' ' + url.pathname;
      state.api.push(key);
      return (answers[key] || ((r) => json(r, 200, { ok: true })))(route, request);
    }
    try {
      const built = await fromBuild(url.pathname + url.search, request.headers().cookie);
      if (built.status >= 400) state.problems.push('HTTP ' + built.status + ' ' + url.pathname);
      const headers = { ...built.headers };
      for (const name of ['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive']) delete headers[name];
      return route.fulfill({ status: built.status, headers, body: built.body });
    } catch (error) {
      state.problems.push(String(error.message));
      return route.abort();
    }
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.addEventListener('securitypolicyviolation', (event) => console.error('CSP blocked ' + event.blockedURI + ' (' + event.violatedDirective + ')'));
  });
  page.on('pageerror', (error) => state.problems.push('page error: ' + error.message));
  page.on('console', (message) => {
    // The sign-in check answers 401 for a guest by design; Chrome reports every 4xx as a console error.
    if (message.type() === 'error' && !/status of 401/.test(message.text())) state.problems.push('console: ' + message.text());
  });
  return { page, state, close: () => context.close() };
}

test('the built site works in a real browser: landing, sign-in, participant feed, admin sign-in', { skip, timeout: 120000 }, async () => {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ channel: process.env.PROKACHKA_BROWSER_CHANNEL || 'chrome', headless: true });
  try {
    // A guest sees the landing page with a way in.
    const guest = await openSite(browser);
    await guest.page.goto(ORIGIN + '/', { waitUntil: 'load' });
    await guest.page.getByRole('heading', { level: 1, name: /Новичок знает, что делать завтра/ }).waitFor();
    // The product pictures are real files that load, not broken frames (the build adds its id after the name).
    assert.ok(await guest.page.locator('img[src^="/landing/program.webp"]').first().evaluate((image) => image.complete && image.naturalWidth > 0), 'the first product screen did not load');
    assert.ok(await guest.page.locator('a[href*="auth="]').count() > 0, 'the landing page has no way to sign in or register');
    assert.deepEqual(guest.state.problems, [], 'the landing page has browser errors');
    await guest.close();

    // Signing in opens the participant's home; their task is on the «Задания» tab.
    const member = await openSite(browser);
    await member.page.goto(ORIGIN + '/?auth=login', { waitUntil: 'domcontentloaded' });
    await member.page.locator('input[name="email"]').fill(user.email);
    await member.page.locator('input[name="password"]').fill('browser-test-password');
    await member.page.locator('button[type="submit"]').click();
    await member.page.getByRole('heading', { name: /Привет, Алия/ }).waitFor({ timeout: 30000 });
    await member.page.getByRole('button', { name: 'Задания' }).click();
    await member.page.getByRole('button', { name: task.title }).first().waitFor();
    assert.deepEqual(member.state.logins, [{ email: user.email, password: 'browser-test-password' }], 'the sign-in form sent something else');
    for (const call of ['GET /api/tasks', 'GET /api/ranking']) assert.ok(member.state.api.includes(call), call + ' was not requested after sign-in');
    assert.deepEqual(member.state.problems, [], 'the participant feed has browser errors');
    assert.deepEqual(member.state.refused, [], 'the site tried to reach an address outside prokachka.kz');
    await member.close();

    // The admin address shows its own sign-in to a guest and does not crash.
    const admin = await openSite(browser);
    await admin.page.goto(ORIGIN + '/admin', { waitUntil: 'load' });
    await admin.page.locator('button[type="submit"]').first().waitFor();
    assert.deepEqual(admin.state.problems, [], 'the admin page has browser errors');
    await admin.close();
  } catch (error) {
    // What the browser showed at the moment of failure, for the CI log artifacts.
    const shots = process.env.PROKACHKA_BROWSER_SHOTS;
    if (shots) {
      let index = 0;
      for (const context of browser.contexts()) for (const page of context.pages()) {
        await page.screenshot({ path: require('node:path').join(shots, 'browser-failure-' + ++index + '.png'), fullPage: true }).catch(() => {});
      }
    }
    throw error;
  } finally { await browser.close(); }
});
