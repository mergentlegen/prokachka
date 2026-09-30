const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const load = require('./helpers/load-ts.cjs');

const dbKey = '@/backend/infrastructure/supabase/admin-client';
const announcementId = '83b84104-7987-4c2d-b6d6-25450a043a7f';

test('phone photo is rotated, bounded, stripped and saved as full plus thumbnail in private Storage', async () => {
  const saved = [], uploads = [], signing = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'announcement_photo_cleanup_queue');
      return { insert(rows) { saved.push(...rows); return Promise.resolve({ error: null }); } };
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'announcement-photos');
      return {
        upload(path, bytes, options) { uploads.push({ path, bytes, options }); return Promise.resolve({ error: null }); },
        createSignedUrls(paths) { signing.push(paths); return Promise.resolve({ data: paths.map(path => ({ path, signedUrl: `https://example.test/${path}` })) }); },
      };
    } },
  };
  const { uploadAnnouncementPhotos, withAnnouncementPhotoUrls, validatePhotoFiles } = load('backend/services/announcement-photos.service.ts', {
    sharp: { default: sharp }, [dbKey]: { getSupabaseAdmin: () => supabase },
  });
  const source = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#3266ab' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const file = new File([source], 'phone.jpg', { type: 'image/jpeg' });
  assert.equal(validatePhotoFiles([file]), null);
  assert.match(validatePhotoFiles(Array(7).fill(file)), /не больше 6/);
  const result = await uploadAnnouncementPhotos(announcementId, [file]);
  assert.ok(result.data, JSON.stringify(result));
  assert.equal(result.data.length, 1);
  assert.equal(uploads.length, 2);
  assert.equal(saved.length, 2);
  assert.ok(uploads.every(item => item.path.startsWith(`${announcementId}/`) && item.options.contentType === 'image/webp' && item.bytes.length < 2 * 1024 * 1024));
  const full = await sharp(uploads[0].bytes).metadata();
  const thumb = await sharp(uploads[1].bytes).metadata();
  assert.equal(full.format, 'webp');
  assert.equal(full.width, 800); assert.equal(full.height, 1200);
  assert.ok(Math.max(thumb.width, thumb.height) <= 640);
  assert.equal(full.exif, undefined);
  const signed = await withAnnouncementPhotoUrls([{ photos: result.data }]);
  assert.equal(signing.flat().length, 2);
  assert.ok(signed[0].photos[0].url.startsWith('https://example.test/'));
  assert.equal('fullPath' in signed[0].photos[0], false);
});

test('temporary URL signing failure never exposes paths or reports a saved announcement as failed', async () => {
  const { withAnnouncementPhotoUrls } = load('backend/services/announcement-photos.service.ts', {
    [dbKey]: { getSupabaseAdmin: () => ({ storage: { from: () => ({ createSignedUrls: async () => ({ error: new Error('Storage unavailable') }) }) } }) },
  });
  const photoId = '70ad926e-318f-48f7-98a0-56d74ef7fc9e';
  const row = { id: announcementId, photos: [{ id: photoId, fullPath: `${announcementId}/${photoId}-full.webp`, thumbPath: `${announcementId}/${photoId}-thumb.webp`, width: 1200, height: 800 }] };
  const result = await withAnnouncementPhotoUrls([row]);
  assert.deepEqual(result, [{ id: announcementId, photos: [] }]);
});

test('announcement photo cleanup only deletes paths in the private bucket and retries failures', async () => {
  const { cleanupAnnouncementPhotos } = require('../scripts/cleanup-announcement-photos.cjs');
  const path = `${announcementId}/70ad926e-318f-48f7-98a0-56d74ef7fc9e-full.webp`;
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).includes('app_claim_')) return Response.json([{ storage_path: path, lease_token: announcementId }]);
    if (String(url).includes('app_ack_')) return new Response(null, { status: 204 });
    return new Response(null, { status: 503 });
  };
  const result = await cleanupAnnouncementPhotos({ env: { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test', NEXT_PUBLIC_SUPABASE_URL: 'https://example.test' }, request });
  assert.deepEqual(result, { removed: 0, deferred: 1 });
  assert.equal(calls[1].url, 'https://example.test/storage/v1/object/announcement-photos');
  assert.equal(calls[2].body.p_success, false);
  await assert.rejects(cleanupAnnouncementPhotos({ env: { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test', NEXT_PUBLIC_SUPABASE_URL: 'https://example.test' }, request: async (url) => String(url).includes('app_claim_') ? Response.json([{ storage_path: '../wrong.webp', lease_token: announcementId }]) : new Response(null, { status: 204 }) }), /Invalid announcement photo cleanup path/);
});

test('announcement multipart API requires publisher rights and does not trust client photo paths', async () => {
  const currentKey = '@/backend/http/current-user';
  const serviceKey = '@/backend/services/announcements.service';
  let actor = { id: announcementId, role: 'member', teamId: '79d4646c-676f-49ce-92b8-75a91fd80366', canPublishTasks: false };
  let saved;
  const controller = load('backend/controllers/announcements.controller.ts', {
    [currentKey]: { getCurrentUser: async () => actor },
    [serviceKey]: { insertAnnouncement: async input => { saved = input; return { data: { id: announcementId, photos: [] } }; } },
  });
  const form = new FormData();
  form.set('title', 'Новости команды'); form.set('content', 'Текст объявления'); form.set('resourceUrl', '');
  form.set('photos', new File([await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).webp().toBuffer()], 'photo.webp', { type: 'image/webp' }));
  form.set('photosPaths', '../../private.png');
  const request = () => new Request('http://localhost/api/announcements', { method: 'POST', body: form });
  assert.equal((await controller.createAnnouncement(request())).status, 403);
  assert.equal(saved, undefined);
  actor = { ...actor, canPublishTasks: true };
  assert.equal((await controller.createAnnouncement(request())).status, 201);
  assert.equal(saved.photoFiles.length, 1);
  assert.equal(saved.audienceRootId, actor.id);
  assert.equal('photosPaths' in saved, false);
});

test('editing keeps only selected photos and refuses another mentor before uploading', async () => {
  const previous = [{ id: 'one' }, { id: 'two' }];
  const added = { id: 'three' };
  const writes = [], uploads = [];
  const row = { id: announcementId, team_id: 'team', author_id: 'owner', photos: previous, updated_at: '2026-09-29T10:00:00Z' };
  const supabase = { from() { return {
    select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: row }; },
    update(patch) { writes.push(patch); return this; }, async single() { return { data: { ...row, ...writes.at(-1) } }; },
  }; } };
  const service = load('backend/services/announcements.service.ts', {
    [dbKey]: { getSupabaseAdmin: () => supabase },
    '@/backend/services/announcement-photos.service': {
      validatePhotoFiles: () => null,
      uploadAnnouncementPhotos: async (id, files) => { uploads.push({ id, files }); return { data: [added], paths: ['staged'] }; },
      releaseAnnouncementPhotoIntent: async () => {},
      withAnnouncementPhotoUrls: async rows => rows,
    },
  });
  const file = new File(['photo'], 'photo.webp', { type: 'image/webp' });
  const input = { title: 'Edited', keepPhotoIds: ['two'], photoFiles: [file] };
  assert.equal((await service.patchAnnouncement(announcementId, input, { id: 'other', role: 'member', teamId: 'team', canPublishTasks: true })).forbidden, true);
  assert.equal(uploads.length, 0);
  const result = await service.patchAnnouncement(announcementId, input, { id: 'owner', role: 'member', teamId: 'team', canPublishTasks: true });
  assert.ok(result.data);
  assert.deepEqual(writes[0].photos, [previous[1], added]);
  assert.equal(uploads[0].id, announcementId);
});
