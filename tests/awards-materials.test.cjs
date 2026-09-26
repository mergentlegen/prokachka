const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');

function load(relative, overrides = {}) {
  const file = path.resolve(root, relative);
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  const original = loaded.require.bind(loaded);
  loaded.require = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.endsWith('.module.css')) return new Proxy({}, { get: (_, key) => key });
    const base = name.startsWith('@/') ? path.join(root, name.slice(2)) : name.startsWith('.') ? path.resolve(path.dirname(file), name) : null;
    if (base) {
      const source = [base + '.ts', base + '.tsx'].find(fs.existsSync);
      if (source) return load(source, overrides);
    }
    return original(name);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
  return loaded.exports;
}

const kinds = load('shared/domain/star-awards.ts');
test('named awards have exactly three stable server-owned values', () => {
  assert.deepEqual(kinds.STAR_AWARD_OPTIONS.map(({ label, stars }) => [label, stars]), [['Starter', 1], ['Classic', 2], ['Premium', 5]]);
  for (const bad of ['Premium', 'unknown', 4, null, {}, '__proto__']) assert.equal(kinds.starAwardOption(bad), undefined);
});

const preview = load('frontend/shared/lib/resource-preview.ts').resourcePreview;
test('YouTube watch, short, embed and live URLs build previews without changing original links', () => {
  for (const url of ['https://www.youtube.com/watch?v=abcdefghijk&t=30s', 'https://youtu.be/abcdefghijk?t=10', 'https://m.youtube.com/shorts/abcdefghijk', 'https://www.youtube-nocookie.com/embed/abcdefghijk', 'https://youtube.com/live/abcdefghijk']) {
    const result = preview(url);
    assert.equal(result.type, 'video');
    assert.equal(result.thumbnail, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
    assert.equal(result.href, url);
  }
});
test('spoofed hosts and malformed IDs never build thumbnail URLs', () => {
  for (const url of ['https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://youtube.com/watch?v=../../secret', 'https://youtu.be/short', 'https://youtube.com/playlist?list=example']) assert.equal(preview(url).thumbnail, undefined);
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', '//example.com', 'https://user:password@example.com', 'x'.repeat(2001), '']) assert.equal(preview(url), undefined);
});
test('websites, private resources and supported forms keep usable links without fetching metadata', () => {
  assert.equal(preview('https://example.com/private?token=abc').type, 'website');
  assert.equal(preview('https://forms.gle/example').action, 'Открыть тест');
  assert.equal(preview('https://docs.google.com/forms/d/example/viewform').type, 'test');
  assert.equal(preview('https://us02web.zoom.us/j/123').type, 'meeting');
  assert.equal(preview('https://fakezoom.us/j/123').type, 'website');
});

test('resource card exposes a prominent safe link even without a preview image', () => {
  const { ResourceCard } = load('frontend/shared/ResourceCard.tsx');
  const markup = renderToStaticMarkup(React.createElement(ResourceCard, { url: 'https://example.com/page' }));
  assert.match(markup, /Открыть материал/);
  assert.match(markup, /example.com/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.ok(!markup.includes('<iframe') && !markup.includes('<img'));
  const video = renderToStaticMarkup(React.createElement(ResourceCard, { url: 'https://youtu.be/abcdefghijk' }));
  assert.match(video, /loading="lazy"/);
  assert.match(video, /Смотреть видео/);
  assert.equal(renderToStaticMarkup(React.createElement(ResourceCard, { url: 'javascript:alert(1)' })), '');
});
test('award modal has accessible radio cards, additive total and no native select', () => {
  const { StarAwardDialog } = load('frontend/features/admin/StarAwardDialog.tsx');
  const markup = renderToStaticMarkup(React.createElement(StarAwardDialog, { name: '<script>Участник', total: 7, busy: false, error: '', onClose() {}, onAward() {} }));
  assert.equal((markup.match(/type="radio"/g) || []).length, 3);
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /7 \+ 1 = 8/);
  assert.match(markup, /&lt;script&gt;/);
  assert.ok(!markup.includes('<select'));
});
test('history mapper preserves old awards and their original totals without inventing a tier', () => {
  const { mapStarAward } = load('frontend/shared/api/client.ts');
  for (const stars of [1, 4, 5]) {
    const award = mapStarAward({ id: 'old', stars });
    assert.equal(award.stars, stars);
    assert.equal(award.kind, undefined);
  }
  const award = mapStarAward({ award_kind: 'premium', stars: 3, mentor: { name: 'Наставник' } });
  assert.equal(award.kind, 'premium');
  assert.equal(award.mentorName, 'Наставник');
});

const dbKey = '@/backend/infrastructure/supabase/admin-client';
const networkKey = '@/backend/services/network.service';
function dbMock(results = {}) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, ops: [] }; calls.push(call);
    const query = new Proxy({}, { get(_, name) {
      if (name === 'then') return (resolve, reject) => Promise.resolve(typeof results[table] === 'function' ? results[table](call) : results[table] || { data: [] }).then(resolve, reject);
      return (...args) => { call.ops.push([name, ...args]); return query; };
    } });
    return query;
  } };
}
test('service inserts independent awards and derives stars from kind, not caller numbers', async () => {
  const db = dbMock();
  const service = load('backend/services/stars.service.ts', { [dbKey]: { getSupabaseAdmin: () => db }, [networkKey]: {} });
  for (const kind of ['starter', 'premium']) await service.insertStarAward({ userId: 'member', mentorId: 'mentor', teamId: 'team', kind, stars: 99, comment: '' });
  const values = db.calls.map((call) => call.ops.find(([op]) => op === 'insert')[1]);
  assert.deepEqual(values.map((value) => value.stars), [1, 5]);
  assert.deepEqual(values.map((value) => value.award_kind), ['starter', 'premium']);
  assert.ok(!db.calls.some(({ ops }) => ops.some(([op]) => op === 'upsert' || op === 'update')));
  assert.equal((await service.insertStarAward({ userId: 'self', mentorId: 'self', kind: 'premium' })).forbidden, true);
});
test('common star ranking uses the SQL aggregate and preserves its totals', async () => {
  const db = dbMock({ aggregate: { data: [{ id: 'b', name: 'Bob', points: '5' }, { id: 'a', name: 'Alice', points: '4' }] } });
  db.rpc = (name, args) => {
    assert.equal(name, 'app_ranking');
    assert.deepEqual(args, { p_team_id: 'team', p_metric: 'stars' });
    return db.from('aggregate');
  };
  const service = load('backend/services/ranking.service.ts', { [dbKey]: { getSupabaseAdmin: () => db } });
  const result = await service.findStarRanking({ kind: 'team', teamId: 'team' });
  assert.deepEqual(result.data.map(({ id, points }) => [id, points]), [['b', 5], ['a', 4]]);
});
test('controller rejects arbitrary amounts, old clients and tampering before inserting', async () => {
  const memberId = '11111111-1111-4111-8111-111111111111';
  const admin = { id: 'mentor', role: 'admin', teamId: 'team' };
  const inserted = [];
  const db = dbMock({ users: { data: { id: memberId, role: 'member', team_id: 'team' } } });
  const controller = load('backend/controllers/stars.controller.ts', {
    '@/backend/http/auth-guard': { getRequestUser: () => admin },
    '@/backend/services/auth.service': { findAccountById: async () => admin },
    '@/backend/services/stars.service': { insertStarAward: async (value) => { inserted.push(value); return { data: value }; } },
    [dbKey]: { getSupabaseAdmin: () => db },
  });
  for (const body of [{ stars: 5 }, { kind: 'unknown' }, { kind: 'premium', stars: 3 }, { kind: 'classic', stars: '2' }]) {
    const response = await controller.createStarAward(new Request('http://localhost/api/stars', { method: 'POST', body: JSON.stringify({ userId: memberId, ...body }) }));
    assert.equal(response.status, 400);
  }
  assert.equal(inserted.length, 0);
  const response = await controller.createStarAward(new Request('http://localhost/api/stars', { method: 'POST', body: JSON.stringify({ userId: memberId, kind: 'premium' }) }));
  assert.equal(response.status, 201);
  assert.equal(inserted[0].kind, 'premium');
});
test('home-screen manifest points to dedicated public PNGs and uses the Russian app name', () => {
  const manifest = load('app/manifest.ts').default();
  assert.equal(manifest.name, 'Прокачка');
  assert.deepEqual(manifest.icons.slice(0, 2).map((icon) => icon.sizes), ['192x192', '512x512']);
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

test('ranking also paginates aggregate results beyond the first thousand members', async () => {
  const db = dbMock({
    aggregate: ({ ops }) => {
      const offset = ops.filter(([op]) => op === 'range').at(-1)[1];
      return { data: Array.from({ length: offset < 1000 ? 500 : 1 }, (_, i) => ({ id: String(offset + i), name: 'Member', points: 3003 })), error: null };
    },
  });
  db.rpc = () => db.from('aggregate');
  const ranking = load('backend/services/ranking.service.ts', { [dbKey]: { getSupabaseAdmin: () => db } });
  const result = await ranking.findStarRanking({ kind: 'all' });
  assert.equal(result.data.length, 1001);
  assert.equal(result.data[1000].points, 3003);
});

test('history records the award label and mentor, never infers a tier for a legacy row', () => {
  const { StarsPanel } = load('frontend/features/admin/StarsPanel.tsx', { '@/frontend/shared/api/admin-client': {} });
  const markup = renderToStaticMarkup(React.createElement(StarsPanel, {
    actorId: 'mentor', users: [{ id: 'a', name: 'Alice', role: 'member' }],
    awards: [
      { id: '1', userId: 'a', kind: 'premium', stars: 3, mentorName: 'Mentor', createdAt: '2026-09-16' },
      { id: '2', userId: 'a', stars: 5, createdAt: '2026-09-15' },
    ], onChange() {}, onError() {},
  }));
  assert.match(markup, /Premium ·/);
  assert.match(markup, /Выдал: Mentor/);
  assert.match(markup, /Награждение звёздами ·/);
  assert.match(markup, /★ 8 звёзд/);
});
