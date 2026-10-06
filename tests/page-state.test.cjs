const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

function fakeWindow(href) {
  const history = { state: { keep: true }, calls: [], replaceState(state, _title, url) { this.calls.push([state, url]); location.href = new URL(url, location.href).href; location.search = new URL(location.href).search; } };
  const location = { href, search: new URL(href).search };
  return { location, history };
}

test('the open section is written to the address without losing other links', () => {
  global.window = fakeWindow('https://prokachka.kz/admin?feedback=abc&invite=xyz#top');
  const page = loadTs('frontend/shared/lib/page-state.ts');
  page.writePageParam('section', 'programs');
  assert.equal(page.readPageParam('section'), 'programs');
  assert.equal(page.readPageParam('invite'), 'xyz', 'other parameters stay');
  assert.match(window.history.calls[0][1], /#top$/, 'the hash stays');
  assert.deepEqual(window.history.calls[0][0], { keep: true }, 'the history entry is replaced, not added');
  page.writePageParam('feedback', null);
  page.writePageParam('section', null);
  assert.equal(new URL(window.location.href).search, '?invite=xyz');
  const calls = window.history.calls.length;
  page.writePageParam('section', null);
  assert.equal(window.history.calls.length, calls, 'nothing is written when nothing changes');
  delete global.window;
});

test('a mentor reopens only the sections they can see', () => {
  const { adminSectionFromPage, adminSectionAllowed } = loadTs('frontend/features/admin/admin-sections.ts');
  const admin = { role: 'admin' };
  const reviewer = { role: 'member', canReview: true };
  const publisher = { role: 'member', canPublishTasks: true };
  assert.equal(adminSectionFromPage('programs', admin), 'programs');
  assert.equal(adminSectionFromPage('programs', reviewer), null, 'a reviewer cannot publish programs');
  assert.equal(adminSectionFromPage('review', publisher), null, 'a publisher cannot review');
  assert.equal(adminSectionFromPage('requests', reviewer), 'requests');
  assert.equal(adminSectionFromPage('network', publisher), 'network');
  assert.equal(adminSectionFromPage('nonsense', admin), null);
  assert.equal(adminSectionFromPage(null, admin), null);
  assert.equal(adminSectionAllowed('welcome-video', reviewer), false);
});
