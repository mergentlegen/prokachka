const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanupDeletedUsers } = require('../scripts/cleanup-deleted-users.cjs');
const loadTs = require('./helpers/load-ts.cjs');

const authId = '11111111-1111-4111-8111-111111111111';
const pdfPath = '22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.pdf';
const lease = '44444444-4444-4444-8444-444444444444';
const env = { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' };

test('deleted account cleanup processes Auth and PDF queues without leaking secret as a JWT', async () => {
  const calls = [];
  const result = await cleanupDeletedUsers({ env, request: async (url, init) => {
    calls.push({ path: url.pathname, init });
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
    if (url.pathname.endsWith('app_claim_user_cleanup')) return Response.json([{ auth_user_id: authId, lease_token: lease }]);
    if (url.pathname.endsWith('app_claim_task_attachment_cleanup')) return Response.json([{ storage_path: pdfPath, lease_token: lease }]);
    return new Response(null, { status: 204 });
  } });
  assert.deepEqual(result, { removed: 2, deferred: 0 });
  assert.ok(calls.some(call => call.path === `/auth/v1/admin/users/${authId}` && call.init.method === 'DELETE'));
  assert.ok(calls.some(call => call.path === '/storage/v1/object/task-attachments' && JSON.parse(call.init.body).prefixes[0] === pdfPath));
  assert.deepEqual(JSON.parse(calls.find(call => call.path.endsWith('app_ack_user_cleanup')).init.body),
    { p_auth_user_id: authId, p_lease: lease, p_success: true });
});

test('failed external deletion keeps a queue entry for retry', async () => {
  const calls = [];
  const result = await cleanupDeletedUsers({ env, request: async (url, init) => {
    calls.push({ path: url.pathname, body: init.body });
    if (url.pathname.endsWith('app_claim_user_cleanup')) return Response.json([{ auth_user_id: authId, lease_token: lease }]);
    if (url.pathname.endsWith('app_claim_task_attachment_cleanup')) return Response.json([]);
    if (url.pathname.startsWith('/auth/v1/admin/users/')) return new Response(null, { status: 500 });
    return new Response(null, { status: 204 });
  } });
  assert.deepEqual(result, { removed: 0, deferred: 1 });
  assert.equal(JSON.parse(calls.find(call => call.path.endsWith('app_ack_user_cleanup')).body).p_success, false);
});

test('worker refuses malformed cleanup paths before deleting storage objects', async () => {
  await assert.rejects(cleanupDeletedUsers({ env, request: async (url) => {
    if (url.pathname.endsWith('app_claim_user_cleanup')) return Response.json([]);
    if (url.pathname.endsWith('app_claim_task_attachment_cleanup')) return Response.json([{ storage_path: '../other.pdf', lease_token: lease }]);
    throw new Error('unexpected deletion');
  } }), /Invalid PDF cleanup path/);
});

test('application deletion commits first and keeps failed Auth removal queued', async () => {
  const calls = [];
  const db = {
    rpc: async (name, params) => {
      calls.push(['rpc', name, params.p_preview]);
      return { data: { deleted: true, authUserId: authId }, error: null };
    },
    auth: { admin: { deleteUser: async (id) => {
      calls.push(['auth', id]);
      return { error: { status: 503 } };
    } } },
  };
  const { deleteUser } = loadTs('backend/services/users.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db },
    '@/backend/infrastructure/supabase/read-pages': { readPages: () => undefined },
  });
  const result = await deleteUser('target-id');
  assert.equal(result.data.cleanupPending, true);
  assert.deepEqual(calls, [['rpc', 'app_delete_user', false], ['auth', authId]]);
});

test('successful Auth deletion clears its durable cleanup job', async () => {
  const calls = [];
  const db = {
    rpc: async () => ({ data: { deleted: true, authUserId: authId }, error: null }),
    auth: { admin: { deleteUser: async () => ({ error: null }) } },
    from: (table) => {
      assert.equal(table, 'user_auth_cleanup_queue');
      return { delete: () => ({ eq: async (field, id) => {
        calls.push([field, id]);
        return { error: null };
      } }) };
    },
  };
  const { deleteUser } = loadTs('backend/services/users.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db },
    '@/backend/infrastructure/supabase/read-pages': { readPages: () => undefined },
  });
  assert.equal((await deleteUser('target-id')).data.cleanupPending, false);
  assert.deepEqual(calls, [['auth_user_id', authId]]);
});
