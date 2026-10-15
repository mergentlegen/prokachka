const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

test('only real JPG, PNG and WebP bytes count as photos; SVG, HTML and look-alikes do not', () => {
  const { rasterFormat } = loadTs('shared/domain/image-bytes.ts');
  assert.equal(rasterFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(rasterFormat(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'png');
  assert.equal(rasterFormat(Buffer.from('RIFF0000WEBPVP8 ')), 'webp');
  for (const fake of ['<svg xmlns="http://www.w3.org/2000/svg"/>', '<html><script>alert(1)</script></html>', 'RIFF0000WAVE', 'GIF89a', '']) {
    assert.equal(rasterFormat(Buffer.from(fake)), null, 'accepted: ' + fake);
  }
  assert.equal(rasterFormat(Buffer.from([0xff, 0xd8])), null, 'a cut header is not a photo');
});

test('an SVG never reaches the image library: avatars and announcement or review photos are refused first', async () => {
  let opened = 0;
  const sharp = () => { opened++; throw new Error('the image library must not open this file'); };
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  const profile = loadTs('backend/services/profile.service.ts', { sharp, '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => null } });
  await assert.rejects(profile.normalizeAvatar(svg), /invalid_avatar_format/);
  const photos = loadTs('backend/services/announcement-photos.service.ts', { sharp, '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({}) } });
  const result = await photos.uploadAnnouncementPhotos('6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', [new File([svg], 'photo.webp', { type: 'image/webp' })]);
  assert.ok(result.validationError, 'an SVG named .webp was accepted');
  assert.equal(opened, 0);
});
