const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const { QueryCache, ScopeChangedError } = load('frontend/shared/lib/query-cache.ts');
const { resourceTopics, mutationTopics, topicsForViewer } = load('shared/domain/live-updates.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(setImmediate);

test('fresh sections share requests and return without a second network fetch', async () => {
  let now = 0, reads = 0;
  const cache = new QueryCache(30, () => now), response = deferred();
  const fetcher = () => { reads++; return response.promise; };
  const one = cache.read('tasks', fetcher), two = cache.read('tasks', fetcher);
  assert.equal(reads, 1);
  response.resolve(['saved']);
  assert.deepEqual(await one, await two);
  await cache.read('tasks', fetcher); assert.equal(reads, 1);
  now = 31; await cache.read('tasks', fetcher); assert.equal(reads, 2);
});

test('invalidation during a pending read cannot overwrite a newer mutation', async () => {
  const cache = new QueryCache(), old = deferred(); let reads = 0;
  const fetcher = () => ++reads === 1 ? old.promise : Promise.resolve('new');
  const pending = cache.read('tasks', fetcher);
  cache.invalidate((key) => key === 'tasks');
  old.resolve('old');
  assert.equal(await pending, 'new');
  assert.equal(cache.peek('tasks'), 'new'); assert.equal(reads, 2);
});

test('logout/account changes discard cached and in-flight private responses', async () => {
  const cache = new QueryCache(); cache.activate('alice');
  await cache.read('users', async () => ['alice-private']);
  const old = deferred(); const pending = cache.read('tasks', () => old.promise);
  let notifications = 0; const unsubscribe = cache.subscribe(() => notifications++);
  cache.activate('bob'); old.resolve('alice-task');
  await assert.rejects(pending, ScopeChangedError);
  assert.equal(cache.peek('users'), undefined); assert.equal(cache.peek('tasks'), undefined);
  assert.equal(await cache.read('tasks', async () => 'bob-task'), 'bob-task');
  cache.activate('bob'); assert.equal(notifications, 1);
  unsubscribe(); cache.activate(''); assert.equal(notifications, 1);
});

test('transient failures retain stale data but do not mark it fresh or cache the rejection', async () => {
  const cache = new QueryCache();
  await cache.read('stars', async () => 3); cache.invalidate(() => true);
  await assert.rejects(cache.read('stars', async () => { throw Error('offline'); }));
  assert.equal(cache.peek('stars'), 3);
  assert.equal(await cache.read('stars', async () => 6), 6);
});

test('session reads deduplicate and a late previous-account response cannot restore its access', async () => {
  const original = global.fetch, response = deferred(), cache = new QueryCache();
  let calls = 0;
  global.fetch = () => { calls++; return response.promise; };
  const { refreshAuthSession } = load('frontend/shared/api/client.ts', {
    '@/frontend/shared/api/data-cache': { dataCache: cache },
  });
  try {
    const first = refreshAuthSession(), second = refreshAuthSession();
    assert.equal(first, second); assert.equal(calls, 1);
    cache.activate('new-login');
    response.resolve(Response.json({ user: { id: 'old-login', role: 'member' } }));
    await assert.rejects(first, /Account scope changed/);
  } finally { global.fetch = original; }
});

test('mutation dependency graph covers ranking/history/queue without invalidating unrelated programs', () => {
  assert.deepEqual(mutationTopics('/api/stars', 'POST'), ['stars']);
  assert.ok(resourceTopics('/api/ranking').includes('stars'));
  assert.ok(!resourceTopics('/api/programs').includes('stars'));
  assert.ok(resourceTopics('/api/tasks?view=member').includes('submissions'));
  assert.ok(resourceTopics('/api/submissions?summary=1').includes('requests'));
  assert.ok(resourceTopics('/api/programs/history').includes('submissions'));
  assert.ok(resourceTopics('/api/publication-history').includes('announcements'));
  assert.deepEqual(mutationTopics('/api/ready-programs', 'POST'), ['tasks', 'programs']);
  assert.ok(resourceTopics('/api/ready-programs').includes('programs'));
  assert.deepEqual(mutationTopics('/api/submissions', 'POST'), [], 'opening Telegram is not submitting a completed answer');
});

test('signals respect teams and notify both old/new team and the affected applicant', () => {
  const change = { topics: ['users', 'network', 'requests', 'session'], teamIds: ['old', 'new'], userIds: ['moved'] };
  assert.deepEqual(topicsForViewer(change, { id: 'other', role: 'member', teamId: 'private' }), []);
  assert.deepEqual(topicsForViewer(change, { id: 'moved', role: 'member' }), change.topics);
  assert.deepEqual(topicsForViewer(change, { id: 'ceo', role: 'ceo' }), ['users', 'network', 'requests']);
  assert.ok(topicsForViewer(change, { id: 'mentor', role: 'admin', teamId: 'old' }).includes('network'));
  assert.ok(topicsForViewer(change, { id: 'deep-child', role: 'member', teamId: 'new' }).includes('session'));
  assert.deepEqual(topicsForViewer({ topics: ['teams'], teamIds: [], userIds: [], catalog: true }, { id: 'applicant', role: 'member' }), ['teams']);
});

test('SSE parser handles split CRLF frames, comments and multiple events', () => {
  const frames = [];
  const { EventStreamParser } = load('frontend/shared/lib/event-stream.ts');
  const parser = new EventStreamParser((...frame) => frames.push(frame));
  for (const char of 'event: ready\r\ndata: {}\r\n\r\n: heartbeat\n\nevent: change\ndata: ["stars"]\n\n') parser.push(char);
  assert.deepEqual(frames, [['ready', '{}'], ['change', '["stars"]']]);
  assert.throws(() => parser.push('a'.repeat(64_001)), /Oversized/);
});

test('member home loads two resources, tasks load only task feed and own submissions', async () => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url) => { calls.push(url); return Response.json({ tasks: [], submissions: [], ranking: [], starRanking: [], announcements: [], awards: [], users: [] }); };
  try {
    const { loadMemberData } = load('frontend/shared/api/client.ts');
    await loadMemberData('member', ['announcements', 'ranking']);
    assert.deepEqual(calls.sort(), ['/api/announcements', '/api/ranking']);
    calls.length = 0; await loadMemberData('member', ['tasks', 'submissions']);
    assert.deepEqual(calls.sort(), ['/api/submissions?userId=member', '/api/tasks?view=member']);
  } finally { global.fetch = original; }
});

const hubKey = '@/backend/services/live-events.service';
const authKey = '@/backend/services/auth.service';
const currentKey = '@/backend/http/current-user';
function eventsRoute(user) {
  let listener, removed = 0;
  const route = load('app/api/events/route.ts', {
    [currentKey]: { getCurrentUser: async () => user },
    [authKey]: { getSessionToken: () => 'signed', readSession: () => user },
    [hubKey]: { liveEvents: { subscribe(value) { listener = value; value.status(true); return () => removed++; } } },
  });
  return { ...route, listener: () => listener, removed: () => removed };
}
test('SSE denies unauthenticated and cross-site requests without opening a subscription', async () => {
  const route = eventsRoute(null);
  assert.equal((await route.GET(new Request('http://localhost/api/events'))).status, 401);
  assert.equal((await route.GET(new Request('http://localhost/api/events', { headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403);
  assert.equal(route.listener(), undefined);
});

test('SSE sends only topic names, filters unrelated teams and releases subscriptions on cancel', async () => {
  const route = eventsRoute({ id: 'member', role: 'member', teamId: 'team' });
  const response = await route.GET(new Request('http://localhost/api/events'));
  assert.equal(response.headers.get('X-Accel-Buffering'), 'no');
  const reader = response.body.getReader(), decode = (chunk) => new TextDecoder().decode(chunk.value);
  assert.match(decode(await reader.read()), /event: ready/);
  route.listener().change({ topics: ['tasks'], teamIds: ['unrelated'], userIds: [] });
  route.listener().change({ topics: ['stars'], teamIds: ['team'], userIds: ['private-id'] });
  const event = decode(await reader.read());
  assert.match(event, /\["stars"\]/); assert.doesNotMatch(event, /private-id|unrelated|team/);
  await reader.cancel(); assert.equal(route.removed(), 1);
});

test('permission signal closes the stream, requiring fresh authorization on reconnect', async () => {
  const route = eventsRoute({ id: 'member', role: 'member', teamId: 'team' });
  const response = await route.GET(new Request('http://localhost/api/events'));
  const reader = response.body.getReader(); await reader.read();
  route.listener().change({ topics: ['session', 'network'], teamIds: ['team'], userIds: ['member'] });
  assert.match(new TextDecoder().decode((await reader.read()).value), /session/);
  assert.equal((await reader.read()).done, true); assert.equal(route.removed(), 1);
});

test('aborted SSE request removes timers/subscription exactly once', async () => {
  const route = eventsRoute({ id: 'admin', role: 'admin', teamId: 'team' });
  const controller = new AbortController();
  const response = await route.GET(new Request('http://localhost/api/events', { signal: controller.signal }));
  controller.abort(); await response.body.cancel();
  assert.equal(route.removed(), 1);
});

test('cold section renders blurred noninteractive placeholder; background data stays interactive', () => {
  const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
  const { SectionBoundary } = load('frontend/shared/SectionBoundary.tsx');
  const cold = renderToStaticMarkup(React.createElement(SectionBoundary, { loading: true }, React.createElement('button', null, 'PRIVATE')));
  assert.match(cold, /aria-busy="true"/); assert.match(cold, /inert/); assert.doesNotMatch(cold, /PRIVATE/);
  const warm = renderToStaticMarkup(React.createElement(SectionBoundary, { loading: false }, React.createElement('button', null, 'Saved section')));
  assert.match(warm, /Saved section/); assert.doesNotMatch(warm, /Загружаем/);
});

// Deterministic timer/event harness: exercises the actual hook effect without a network/service account.
test('live updates coalesce bursts, pause when hidden and resync after becoming visible', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originalWindow = global.window, originalDocument = global.document;
  const win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'visible';
  global.window = win; global.document = doc;
  const effects = [], callbacks = [], invalidations = [], connections = [];
  const fakeReact = { useRef: (current) => ({ current }), useEffect: (effect) => effects.push(effect) };
  const { useLiveUpdates } = load('frontend/shared/hooks/use-live-updates.ts', {
    react: fakeReact,
    '@/frontend/shared/api/client': { openLiveStream: async (signal) => {
      let writer; const body = new ReadableStream({ start(controller) { writer = controller; } });
      signal.addEventListener('abort', () => { try { writer.close(); } catch {} });
      connections.push({ signal, send: (value) => writer.enqueue(new TextEncoder().encode(value)) });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    } },
    '@/frontend/shared/api/data-cache': { invalidateData: (topics) => invalidations.push(topics), localChangeEvent: 'local-change' },
  });
  let cleanup;
  try {
    useLiveUpdates({ id: 'user', role: 'member', teamId: 'team' }, async (topics) => callbacks.push(topics));
    effects[0](); cleanup = effects[1](); await tick();
    connections[0].send('event: ready\ndata: {}\n\n'); await tick();
    t.mock.timers.tick(250); await tick(); callbacks.length = 0;
    connections[0].send('event: change\ndata: ["stars"]\n\nevent: change\ndata: ["submissions", "stars"]\n\n');
    await tick(); t.mock.timers.tick(250); await tick();
    assert.equal(callbacks.length, 1); assert.deepEqual(callbacks[0].sort(), ['stars', 'submissions']);
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); await tick();
    assert.equal(connections[0].signal.aborted, true);
    const count = callbacks.length; t.mock.timers.tick(180_000); await tick();
    assert.equal(callbacks.length, count); assert.equal(connections.length, 1);
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); await tick();
    t.mock.timers.tick(250); await tick();
    assert.equal(connections.length, 2); assert.ok(callbacks.at(-1).includes('resync'));
    assert.ok(invalidations.length > 0);
  } finally { cleanup?.(); await tick(); global.window = originalWindow; global.document = originalDocument; }
});

test('mentor navigation retains visited sections, shares datasets and rejects late responses from another scope', async () => {
  const harness = require('./helpers/hook-harness.cjs')();
  const cache = new QueryCache(); cache.activate('mentor');
  const originalWindow = global.window, originalFetch = global.fetch;
  global.window = { setTimeout, clearTimeout, sessionStorage: { getItem: () => null } };
  const calls = [], network = deferred();
  const user = { id: 'mentor', role: 'admin', teamId: 'team' };
  global.fetch = async (url) => {
    calls.push(url);
    if (url === '/api/network') return network.promise;
    return Response.json({ ok: true, tasks: [{ id: 'task', title: 'Cached task', is_active: true }], users: [], submissions: [], ranking: [], counts: { pending: 0, accepted: 0, requests: 0 } });
  };
  const { useAdminData } = load('frontend/features/admin/use-admin-data.ts', {
    react: harness.react,
    '@/frontend/shared/api/data-cache': { dataCache: cache, announceMutation() {} },
  });
  try {
    assert.equal(harness.mount(useAdminData, user, 'dashboard').dataLoading, true);
    assert.equal((await harness.settle()).dataLoading, false);
    harness.render(user, 'tasks');
    assert.equal((await harness.settle()).store.tasks[0].title, 'Cached task');
    assert.equal(calls.filter((url) => url === '/api/tasks').length, 1, 'dashboard and tasks share the same response');
    assert.equal(harness.render(user, 'dashboard').dataLoading, false, 'no loading screen on a visited section');
    await harness.settle();
    assert.equal(harness.render(user, 'network').dataLoading, true);
    assert.equal(harness.render(user, 'tasks').dataLoading, false, 'slow network section cannot block menu navigation');
    await harness.settle();
    cache.activate('another-account');
    const other = { ...user, id: 'other', teamId: 'private' };
    const cleared = harness.render(other, 'tasks');
    assert.equal(cleared.dataLoading, true); assert.deepEqual(cleared.store.tasks, []);
    network.resolve(Response.json({ users: [{ id: 'old-private-member' }] }));
    const final = await harness.settle();
    assert.deepEqual(final.networkUsers, []);
    assert.equal(final.dataLoading, false);
  } finally { harness.unmount(); global.window = originalWindow; global.fetch = originalFetch; }
});

test('member cached tabs remain visible during refresh and discard another account snapshot immediately', async () => {
  const harness = require('./helpers/hook-harness.cjs')(), cache = new QueryCache(); cache.activate('alice');
  let slow;
  const empty = { store: { tasks: [], submissions: [], announcements: [], users: [], programs: [], programProgress: [], starAwards: [] }, ranking: [], starRanking: [], network: [] };
  const { useMemberData } = load('frontend/features/member/use-member-data.ts', {
    react: harness.react, '@/frontend/shared/api/data-cache': { dataCache: cache },
    '@/frontend/shared/api/client': { loadMemberData: async () => slow ? slow.promise : empty },
  });
  const user = { id: 'alice', role: 'member', teamId: 'team' };
  try {
    harness.mount(useMemberData, user, 'home'); await harness.settle();
    harness.render(user, 'ranking'); await harness.settle();
    const home = harness.render(user, 'home'); assert.equal(home.dataLoading, false);
    slow = deferred(); const refreshing = home.refreshData();
    assert.equal(harness.render().dataLoading, false, 'background refresh never blurs a loaded page');
    cache.activate('bob');
    const moved = harness.render({ ...user, id: 'bob' }, 'home');
    assert.equal(moved.dataLoading, true); assert.deepEqual(moved.ranking, []);
    slow.resolve(empty); await refreshing; await harness.settle();
  } finally { harness.unmount(); }
});

test('failed realtime reconnects do not postpone the 30-second fallback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originalWindow = global.window, originalDocument = global.document;
  global.window = new EventTarget(); global.document = new EventTarget(); global.document.visibilityState = 'visible';
  const effects = [], changes = []; let connections = 0;
  const { useLiveUpdates } = load('frontend/shared/hooks/use-live-updates.ts', {
    react: { useRef: (current) => ({ current }), useEffect: (effect) => effects.push(effect) },
    '@/frontend/shared/api/client': { openLiveStream: async () => { connections++; throw Error('offline'); } },
    '@/frontend/shared/api/data-cache': { invalidateData() {}, localChangeEvent: 'local-change' },
  });
  let cleanup;
  try {
    useLiveUpdates({ id: 'member', role: 'member' }, async (topics) => changes.push(topics));
    effects[0](); cleanup = effects[1](); await tick();
    for (let i = 0; i < 31; i++) { t.mock.timers.tick(1_000); await tick(); }
    assert.ok(connections >= 4); assert.equal(changes.length, 1); assert.deepEqual(changes[0], ['resync']);
  } finally { cleanup?.(); await tick(); global.window = originalWindow; global.document = originalDocument; }
});

test('server shares one private upstream channel and closes it after the last browser leaves', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  delete global.prokachkaLiveHub;
  let opened = 0, removed = 0, disconnected = 0, deliver, setStatus;
  const channel = { on(_kind, _filter, callback) { deliver = callback; return this; }, subscribe(callback) { setStatus = callback; return this; } };
  const { liveEvents } = load('backend/services/live-events.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({
      channel(topic, options) { opened++; assert.equal(topic, 'prokachka:changes'); assert.equal(options.config.private, true); return channel; },
      removeChannel: async () => { removed++; }, realtime: { disconnect: () => disconnected++ },
    }) },
  });
  const changes = [], statuses = [];
  const listener = { change: (event) => changes.push(event), status: (ready) => statuses.push(ready) };
  const first = liveEvents.subscribe(listener), second = liveEvents.subscribe({ ...listener });
  try {
    assert.equal(opened, 1);
    setStatus('SUBSCRIBED');
    deliver({ payload: { topics: ['stars', 'not-a-topic'], teamIds: ['team'], userIds: [], secret: 'ignored' } });
    assert.equal(changes.length, 2); assert.deepEqual(changes[0].topics, ['stars']); assert.equal(changes[0].secret, undefined);
    first(); t.mock.timers.tick(10_000); await tick(); assert.equal(removed, 0);
    second(); t.mock.timers.tick(10_000); await tick(); assert.equal(removed, 1); assert.equal(disconnected, 1);
    assert.ok(statuses.includes(true));
  } finally { delete global.prokachkaLiveHub; }
});
