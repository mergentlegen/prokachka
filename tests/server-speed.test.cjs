const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

test('Supabase requests reuse connections kept open for a minute', async () => {
  const timed = loadTs('backend/infrastructure/supabase/timed-fetch.ts');
  assert.equal(timed.KEEP_ALIVE_MS, 60_000);
  const original = global.fetch;
  const seen = [];
  global.fetch = async (input, init) => { seen.push(init); return new Response('{}', { status: 200 }); };
  try {
    await timed.timedFetch()('https://example.supabase.co/rest/v1/tasks', { method: 'GET' });
    await timed.timedFetch(5_000)('https://example.supabase.co/auth/v1/token', { method: 'POST' });
  } finally { global.fetch = original; }
  assert.equal(seen.length, 2);
  for (const init of seen) assert.equal(init.dispatcher, timed.supabaseAgent, 'every request goes through the kept-alive pool');
  await timed.supabaseAgent.close();
});

test('a stopping server closes every live stream at once; closed streams are forgotten', () => {
  const live = loadTs('backend/services/live-events.service.ts', { '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => null } });
  const closed = [];
  const untrackFirst = live.trackLiveStream(() => closed.push('first'));
  live.trackLiveStream(() => closed.push('second'));
  live.trackLiveStream(() => { throw new Error('client already gone'); });
  untrackFirst();
  assert.equal(live.closeLiveStreams(), 2, 'the untracked stream is not closed again');
  assert.deepEqual(closed, ['second']);
  assert.equal(live.closeLiveStreams(), 0, 'nothing is closed twice');
  assert.ok(live.STOP_GRACE_MS <= 10_000, 'a restart never waits the old 30 seconds');
});

test('the live stream route registers each stream for the fast stop', () => {
  const source = require('node:fs').readFileSync('app/api/events/route.ts', 'utf8');
  assert.match(source, /untrack = trackLiveStream\(finish\)/);
  assert.match(source, /release\(\); untrack\(\);/);
});
