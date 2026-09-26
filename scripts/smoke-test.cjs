// Read-only checks: no accounts, writes, Telegram messages or Supabase requests.
const assert = require('node:assert/strict');
const http = require('node:http');

function request(base, pathname, host = 'prokachka.kz', method = 'GET') {
  return new Promise((resolve, reject) => {
    const headers = { Host: host, ...(method === 'GET' ? {} : { Origin: 'https://' + host }) };
    const req = http.request(new URL(pathname, base), { method, headers, timeout: 3000 }, (res) => {
      const chunks = [];
      res.on('data', (data) => chunks.push(data));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function smoke(base, release) {
  const url = new URL(base);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Smoke checks require a loopback HTTP URL');
  const deadline = Date.now() + 45000;
  while (true) {
    try {
      const health = await request(base, '/api/health');
      assert.equal(health.status, 200);
      assert.deepEqual(JSON.parse(health.body), { status: 'ok', release });
      assert.match(health.headers['cache-control'], /no-store/);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw new Error('Release did not become healthy: ' + error.message);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  for (const pathname of ['/', '/admin', '/ceo']) {
    const page = await request(base, pathname);
    assert.equal(page.status, 200, pathname);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.body.toString(), /Прокачка/);
    const assets = [...page.body.toString().matchAll(/(?:src|href)="([^"<>]*\/_next\/static\/[^"<>]+\.(?:js|css)(?:\?[^"<>]*)?)"/g)];
    assert.ok(assets.length, pathname + ' must reference built assets');
    for (const [, asset] of assets) {
      const result = await request(base, asset.replaceAll('&amp;', '&'));
      assert.equal(result.status, 200, asset);
      assert.ok(result.body.length > 0, asset);
      assert.doesNotMatch(result.headers['content-type'] || '', /text\/html/, asset);
    }
  }
  const font = await request(base, '/fonts/manrope-cyrillic.woff2');
  assert.equal(font.status, 200);
  assert.equal(font.body.subarray(0, 4).toString(), 'wOF2');
  assert.equal((await request(base, '/brand/logo.svg')).status, 200);
  assert.equal((await request(base, '/api/auth/session')).status, 401);
  // Loading the actual profile route also loads its native image dependency.
  // No session/body means no database or Storage operation can take place.
  const profile = await request(base, '/api/profile', 'prokachka.kz', 'PATCH');
  assert.equal(profile.status, 401, 'Profile API must load successfully before rejecting an unauthenticated request');
  assert.match(profile.headers['content-type'] || '', /application\/json/);
  assert.equal(JSON.parse(profile.body).ok, false);
  // Exercise the native binary, not just module resolution, inside this artifact.
  const sharp = require('sharp');
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#3255b3' } }).resize(1, 1).webp().toBuffer();
  assert.equal((await sharp(image).metadata()).format, 'webp', 'Packaged Sharp must encode and decode WebP');
  assert.equal((await request(base, '/', 'untrusted.invalid')).status, 403);
  console.log('Smoke checks passed for ' + release);
}

module.exports = { smoke };
if (require.main === module) smoke(process.argv[2], process.argv[3]).catch((error) => {
  console.error(error.message); process.exitCode = 1;
});
