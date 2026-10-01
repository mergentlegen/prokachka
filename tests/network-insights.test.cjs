const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const DAY = 86_400_000;
const daysAgo = (days) => new Date(Date.now() - days * DAY).toISOString();
const row = (id, parent = null, extra = {}) => ({ id, name: id, role: 'member', team_id: 'team', parent_user_id: parent, created_at: '2026-01-01T00:00:00Z', ...extra });

// Minimal Supabase double: every builder call is recorded, awaiting resolves the table's fixture.
function database({ users, points = [], stars = [], submissions = [], telegram = [], failStars = false }) {
  const calls = [];
  const query = (call, resolve) => {
    const builder = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (ok, fail) => Promise.resolve(resolve(call)).then(ok, fail);
      return (...args) => { call.ops.push([key, ...args]); return builder; };
    } });
    return builder;
  };
  return {
    calls,
    from(table) {
      const call = { table, ops: [] }; calls.push(call);
      return query(call, ({ ops }) => {
        const range = ops.find(([op]) => op === 'range');
        const page = (data) => ({ data: range && range[1] > 0 ? [] : data, error: null });
        if (table === 'submissions') return page(submissions);
        if (table === 'users') return ops.some(([op, column]) => op === 'not' && column === 'telegram_id') ? page(telegram) : page(users);
        return page([]);
      });
    },
    rpc(name, args) {
      const call = { table: `rpc:${name}:${args.p_metric}`, ops: [] }; calls.push(call);
      return query(call, ({ ops }) => {
        const range = ops.find(([op]) => op === 'range');
        if (args.p_metric === 'stars' && failStars) return { data: null, error: { message: 'boom' } };
        const data = args.p_metric === 'points' ? points : stars;
        return { data: range && range[1] > 0 ? [] : data, error: null };
      });
    },
  };
}

function networkService(db) {
  return loadTs('backend/services/network.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db },
    '@/backend/services/avatar-urls.service': { withAvatarUrls: async (rows) => rows },
  });
}

const team = [row('lead', null, { role: 'admin' }), row('anna', 'lead'), row('ivan', 'anna'), row('olga', 'lead', { team_joined_at: daysAgo(2) })];
const fixtures = {
  users: team,
  points: [{ id: 'anna', points: 120 }, { id: 'ivan', points: '45' }, { id: 'olga', points: 0 }],
  stars: [{ id: 'anna', points: 3 }, { id: 'ivan', points: 0 }, { id: 'olga', points: 1 }],
  submissions: [{ id: 's1', user_id: 'ivan', submitted_at: daysAgo(3) }, { id: 's2', user_id: 'ivan', submitted_at: daysAgo(1) }],
  telegram: [{ id: 'ivan' }],
};

test('a participant sees miles and stars of their own branch, but never activity or Telegram status', async () => {
  const db = database(fixtures);
  const result = await networkService(db).getNetworkForViewer({ id: 'anna', role: 'member', teamId: 'team' });
  assert.deepEqual(result.data.map((user) => user.id).sort(), ['anna', 'ivan'], 'only the own branch is returned');
  const ivan = result.data.find((user) => user.id === 'ivan');
  assert.equal(ivan.points, 45);
  assert.equal(ivan.stars, 0);
  for (const user of result.data) {
    assert.equal(user.recentSubmissions, undefined);
    assert.equal(user.lastSubmittedAt, undefined);
    assert.equal(user.hasTelegram, undefined);
  }
  assert.ok(!db.calls.some((call) => call.table === 'submissions'), 'participants do not trigger the activity query');
  assert.ok(!db.calls.some((call) => call.ops.some(([op, column]) => op === 'not' && column === 'telegram_id')));
  assert.ok(!db.calls.find((call) => call.table === 'users').ops.some(([op, columns]) => op === 'select' && /telegram_id/.test(columns)), 'raw Telegram ids are never selected for the network');
});

test('a mentor sees activity for the last 30 days and whether Telegram is connected', async () => {
  const db = database(fixtures);
  const result = await networkService(db).getNetworkForViewer({ id: 'lead', role: 'admin', teamId: 'team' });
  const byId = Object.fromEntries(result.data.map((user) => [user.id, user]));
  assert.equal(byId.ivan.recentSubmissions, 2);
  assert.equal(byId.ivan.lastSubmittedAt, fixtures.submissions[1].submitted_at);
  assert.equal(byId.ivan.hasTelegram, true);
  assert.equal(byId.olga.recentSubmissions, 0);
  assert.equal(byId.olga.hasTelegram, false);
  assert.equal(byId.olga.teamJoinedAt, team[3].team_joined_at);
  assert.equal(byId.lead.points, undefined, 'team leaders are not ranked participants');
  const activity = db.calls.find((call) => call.table === 'submissions');
  const since = activity.ops.find(([op]) => op === 'gte');
  assert.equal(since[1], 'submitted_at');
  assert.ok(Math.abs(Date.parse(since[2]) - (Date.now() - 30 * DAY)) < 60_000);
  assert.deepEqual(activity.ops.find(([op]) => op === 'eq'), ['eq', 'users.team_id', 'team']);
});

test('if the stats cannot load, the network still opens without misleading zero miles', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const result = await networkService(database({ ...fixtures, failStars: true })).getNetworkForViewer({ id: 'lead', role: 'admin', teamId: 'team' });
    assert.equal(result.data.length, 4);
    for (const user of result.data) { assert.equal(user.points, undefined); assert.equal(user.stars, undefined); }
  } finally { console.warn = warn; }
});

const tree = loadTs('frontend/shared/lib/network-tree.ts');
const member = (id, parentUserId, extra = {}) => ({ id, name: id, role: 'member', parentUserId, createdAt: '2026-01-01T00:00:00Z', ...extra });

test('activity labels: recent work, quiet for two weeks, nothing for a month, hidden without access', () => {
  assert.equal(tree.networkActivity(member('a', undefined, { recentSubmissions: 1, lastSubmittedAt: daysAgo(3) })), 'active');
  assert.equal(tree.networkActivity(member('a', undefined, { recentSubmissions: 1, lastSubmittedAt: daysAgo(20) })), 'quiet');
  assert.equal(tree.networkActivity(member('a', undefined, { recentSubmissions: 0 })), 'inactive');
  assert.equal(tree.networkActivity(member('a')), undefined, 'participants without access see no activity');
  assert.equal(tree.networkActivity({ ...member('a', undefined, { recentSubmissions: 0 }), role: 'admin' }), undefined);
});

test('new members are marked for seven days after joining the team', () => {
  assert.equal(tree.isNewMember(member('a', undefined, { teamJoinedAt: daysAgo(2) })), true);
  assert.equal(tree.isNewMember(member('a', undefined, { teamJoinedAt: daysAgo(9) })), false);
  assert.equal(tree.isNewMember(member('a', undefined, { teamJoinedAt: 'broken' })), false);
});

test('sorting by miles keeps branches together and the path is read from the top down', () => {
  const users = [member('root'), member('a-low', 'root', { points: 5 }), member('z-high', 'root', { points: 90 }), member('child', 'a-low', { points: 500 })];
  assert.deepEqual(tree.buildNetworkTree(users).map((entry) => entry.user.id), ['root', 'a-low', 'child', 'z-high']);
  assert.deepEqual(tree.buildNetworkTree(users, 'miles').map((entry) => entry.user.id), ['root', 'z-high', 'a-low', 'child']);
  const byId = new Map(users.map((user) => [user.id, user]));
  assert.deepEqual(tree.networkAncestors(byId, byId.get('child')).map((user) => user.id), ['root', 'a-low']);
  assert.deepEqual(tree.networkAncestors(new Map([['a', member('a', 'b')], ['b', member('b', 'a')]]), member('a', 'b')).map((user) => user.id), ['b'], 'legacy cycles stop');
});

test('each row shows miles, stars and badges; the card and its settings stay closed until tapped', () => {
  const { NetworkTree } = loadTs('frontend/shared/NetworkTree.tsx');
  let controls = 0;
  const users = [
    member('me', undefined, { name: 'Анна', points: 120, stars: 3 }),
    member('ivan', 'me', { name: 'Иван', points: 1, stars: 0, teamJoinedAt: daysAgo(1), recentSubmissions: 0 }),
  ];
  const markup = renderToStaticMarkup(React.createElement(NetworkTree, { users, currentUserId: 'me', renderControls() { controls++; return null; } }));
  assert.match(markup, /<b>120<\/b><small>миль<\/small>/);
  assert.match(markup, /★ 3/);
  assert.match(markup, /<b>1<\/b><small>миля<\/small>/);
  assert.ok(!/★ 0/.test(markup), 'zero stars are not shown');
  assert.match(markup, /Новый/);
  assert.match(markup, /1-я линия/);
  assert.match(markup, /Нет работ 30 дней/);
  assert.match(markup, /aria-label="Открыть карточку: Иван"/);
  assert.equal(controls, 0);
  assert.ok(!markup.includes('role="dialog"'));
});

test('member settings start with the current leader and switches, without rendering the whole team list', () => {
  const { NetworkMemberSettings } = loadTs('frontend/features/admin/NetworkMemberSettings.tsx');
  const users = [member('lead', undefined, { role: 'admin', name: 'Лидер' }), member('anna', 'lead', { name: 'Анна', canReview: true }), ...Array.from({ length: 50 }, (_, i) => member(`m${i}`, 'lead'))];
  const markup = renderToStaticMarkup(React.createElement(NetworkMemberSettings, { user: users[1], users, busy: false, onSave: async () => true }));
  assert.match(markup, /Лидер/);
  assert.match(markup, /Изменить/);
  assert.equal((markup.match(/role="switch"/g) || []).length, 2);
  assert.match(markup, /role="switch" checked=""/);
  assert.ok(!markup.includes('<li'), 'the leader picker opens only on demand');
});
