const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { randomUUID } = require('node:crypto');
const load = require('./helpers/load-ts.cjs');
const dbKey = '@/backend/infrastructure/supabase/admin-client';
const ownId = '11111111-1111-4111-8111-111111111111';
const version = '2026-09-26T10:00:00.000Z';

test('profile names normalize whitespace and reject invisible/control characters', () => {
  const { validateProfileNames, avatarInitials } = load('shared/domain/profile.ts');
  assert.deepEqual(validateProfileNames('  Анна  Мария ', ' Ибрагимова '), { firstName: 'Анна Мария', lastName: 'Ибрагимова' });
  assert.ok(validateProfileNames('A', 'Surname').error);
  assert.ok(validateProfileNames('Анна\u202e', 'Фамилия').error);
  assert.equal(avatarInitials('   Анна    Мария    Иванова'), 'АМ');
});

test('uploaded photos are square WebP with bounded size and no EXIF metadata', async () => {
  const { normalizeAvatar } = load('backend/services/profile.service.ts', { sharp: { default: sharp }, [dbKey]: { getSupabaseAdmin: () => null } });
  const original = await sharp({ create: { width: 960, height: 640, channels: 3, background: '#3054ab' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await normalizeAvatar(original);
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 512); assert.equal(metadata.height, 512);
  assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
  assert.ok(result.length < 256 * 1024);
  await assert.rejects(normalizeAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>')));
  await assert.rejects(normalizeAvatar(Buffer.alloc(512 * 1024 + 1)));
  const large = await sharp({ create: { width: 2400, height: 2400, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(normalizeAvatar(large));
});

test('crop coordinates stay within the source image for portrait, landscape and zoom', () => {
  const { cropRegion } = load('frontend/features/profile/avatar-image.ts');
  assert.deepEqual(cropRegion(800, 400, { x: 0.5, y: 0.5, zoom: 1 }), { left: 200, top: 0, side: 400 });
  assert.deepEqual(cropRegion(400, 800, { x: 9, y: -1, zoom: 3 }), { left: 400 - 400 / 3, top: 0, side: 400 / 3 });
});

test('multipart bodies without Content-Length are still bounded', async () => {
  const { readLimitedFormData, FormDataLimitError } = load('backend/http/form-data.ts');
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); controller.enqueue(new Uint8Array(100)); controller.close(); } });
  await assert.rejects(readLimitedFormData(new Request('http://localhost/api/profile', { method: 'PATCH', body, duplex: 'half' }), 150), FormDataLimitError);
  const form = new FormData(); form.set('firstName', 'Anna');
  assert.equal((await readLimitedFormData(new Request('http://localhost/api/profile', { method: 'PATCH', body: form }), 1024)).get('firstName'), 'Anna');
});

function controller(actor, overrides = {}) {
  return load('backend/controllers/profile.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => actor },
    '@/backend/http/security': { isUuid: value => value === ownId, enforceRateLimit: () => null },
    '@/backend/config/env': { serverEnv: { authDevMode: false } },
    '@/backend/services/auth.service': { findAccountById: async () => ({ ...actor, firstName: 'Anna', lastName: 'Member' }), createSession: () => 'test-session' },
    '@/backend/services/profile.service': { normalizeAvatar: () => assert.fail('unexpected normalization'), saveOwnProfile: () => assert.fail('unexpected write') },
    ...overrides,
  });
}
function profileRequest(patch = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ firstName: 'Anna', lastName: 'Member', avatarAction: 'keep', expectedVersion: version, ...patch })) form.set(key, value);
  return new Request('http://localhost/api/profile', { method: 'PATCH', body: form });
}
test('profile API uses the fresh authenticated account and never accepts caller permissions or email', async () => {
  assert.equal((await controller(null).updateOwnProfile(profileRequest())).status, 401);
  assert.equal((await controller({ id: 'ceo' }).updateOwnProfile(profileRequest())).status, 403);
  const calls = [];
  const actor = { id: ownId, name: 'Anna Member', role: 'member', teamId: 'team' };
  const api = controller(actor, { '@/backend/services/profile.service': { saveOwnProfile: async (...args) => { calls.push(args); return { data: true }; } } });
  const result = await api.updateOwnProfile(profileRequest({ userId: 'other-person', role: 'admin', email: 'other@test.invalid' }));
  assert.equal(result.status, 200);
  assert.equal(calls[0][0], ownId);
  assert.deepEqual(calls[0][1], { firstName: 'Anna', lastName: 'Member', expectedVersion: version, avatarAction: 'keep', avatar: undefined });
  assert.match(result.headers.get('set-cookie'), /^incruises_session=test-session;/);
  assert.equal((await api.updateOwnProfile(profileRequest({ firstName: 'A' }))).status, 400);
  assert.equal((await api.updateOwnProfile(profileRequest({ expectedVersion: 'invalid' }))).status, 409);
  assert.equal(calls.length, 1);
});

test('concurrent edits return a conflict; a lost RPC response never deletes a possibly active photo', async () => {
  const steps = [];
  const query = new Proxy({}, { get: (_, key) => key === 'then' ? resolve => resolve({ error: null }) : (...args) => { steps.push([key, ...args]); return query; } });
  const service = load('backend/services/profile.service.ts', { [dbKey]: { getSupabaseAdmin: () => ({
    from: () => query,
    storage: { from: bucket => ({ upload: async () => { steps.push(['upload', bucket]); return { error: null }; }, remove: () => assert.fail('possible live photo deletion') }) },
    rpc: async () => ({ error: new Error('lost response') }),
  }) } });
  assert.ok((await service.saveOwnProfile(ownId, { firstName: 'Anna', lastName: 'Member', expectedVersion: version, avatarAction: 'replace', avatar: Buffer.from('optimized') })).error);
  assert.equal(steps[0][0], 'insert'); assert.equal(steps[1][0], 'upload');
  const api = controller({ id: ownId }, { '@/backend/services/profile.service': { saveOwnProfile: async () => ({ conflict: true }) } });
  assert.equal((await api.updateOwnProfile(profileRequest())).status, 409);
});

test('signed avatar URLs are reused across datasets; all rows survive bounded caching', async () => {
  let calls = 0, concurrent = 0, peak = 0;
  const signer = load('backend/services/avatar-urls.service.ts', { [dbKey]: { getSupabaseAdmin: () => ({ storage: { from: bucket => {
    assert.equal(bucket, 'profile-avatars');
    return { createSignedUrls: async paths => {
      calls++; concurrent++; peak = Math.max(peak, concurrent);
      await new Promise(resolve => setTimeout(resolve, 1)); concurrent--;
      return { data: paths.map(path => ({ path, signedUrl: 'https://cdn.test/' + path })), error: null };
    } };
  } } }) } });
  const one = [{ id: ownId, avatar_path: `${ownId}/${randomUUID()}.webp` }];
  const [a, b] = await Promise.all([signer.withAvatarUrls(one), signer.withAvatarUrls(one)]);
  assert.equal(calls, 1); assert.equal(a[0].avatar_url, b[0].avatar_url);
  assert.equal(a[0].avatar_path, undefined);
  const many = Array.from({ length: 5100 }, () => ({ avatar_path: `${ownId}/${randomUUID()}.webp` }));
  const signed = await signer.withAvatarUrls(many);
  assert.equal(signed.filter(row => row.avatar_url).length, 5100); assert.ok(peak <= 4);
});

test('cleanup only deletes queued avatar paths and preserves failed jobs for retry', async () => {
  const { cleanupAvatars } = require('../scripts/cleanup-profile-avatars.cjs');
  const path = `${ownId}/${randomUUID()}.webp`, calls = [];
  const result = await cleanupAvatars({ env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only' }, request: async (url, init) => {
    calls.push([new URL(url).pathname, JSON.parse(init.body)]);
    if (String(url).includes('app_claim_')) return Response.json([{ storage_path: path, lease_token: ownId }]);
    if (String(url).includes('/storage/')) return new Response('', { status: 503 });
    return new Response(null, { status: 204 });
  } });
  assert.deepEqual(result, { removed: 0, deferred: 1 });
  assert.deepEqual(calls[1], ['/storage/v1/object/profile-avatars', { prefixes: [path] }]);
  assert.equal(calls[2][1].p_status, 503);
});
