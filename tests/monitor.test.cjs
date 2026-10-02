const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

const secret = 's'.repeat(40);
const env = { '@/backend/config/env': { serverEnv: { telegramDeliverySecret: secret } } };

test('internal endpoints accept only the server secret', () => {
  const { isInternalRequest } = loadTs('backend/http/internal-auth.ts', env);
  const req = (header) => new Request('http://x.test', { headers: header ? { authorization: header } : {} });
  assert.equal(isInternalRequest(req()), false);
  assert.equal(isInternalRequest(req('Bearer wrong')), false);
  assert.equal(isInternalRequest(req('Bearer ' + secret)), true);
  const weak = loadTs('backend/http/internal-auth.ts', { '@/backend/config/env': { serverEnv: { telegramDeliverySecret: 'short' } } });
  assert.equal(weak.isInternalRequest(req('Bearer short')), false, 'a short secret disables the door');
});

test('monitor counts only sendable jobs and how long the oldest ready one waits', async () => {
  const now = Date.parse('2026-10-03T10:00:00Z');
  const calls = [];
  const db = { from() {
    const ops = []; calls.push(ops);
    const query = new Proxy({}, { get(_t, key) {
      if (key === 'then') return (resolve) => resolve(ops.some(([op]) => op === 'gte')
        ? { data: [], count: 2, error: null }
        : { data: [{ available_at: '2026-10-03T09:40:00Z' }], count: 7, error: null });
      return (...args) => { ops.push([key, ...args]); return query; };
    } });
    return query;
  } };
  const { monitorSnapshot } = loadTs('backend/services/monitor.service.ts', { '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db } });
  const result = await monitorSnapshot(now);
  assert.deepEqual(result.data.queue, { waiting: 7, oldestMinutes: 20, failing: 2 });
  assert.ok(calls.every((ops) => ops.some(([op, column]) => op === 'not' && column === 'users.telegram_id')), 'jobs nobody can receive are ignored');
  const broken = loadTs('backend/services/monitor.service.ts', { '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ from() {
    const q = new Proxy({}, { get(_t, key) { return key === 'then' ? (resolve) => resolve({ data: null, error: { code: 'x' } }) : () => q; } }); return q;
  } }) } });
  assert.ok('error' in await broken.monitorSnapshot(now));
});
