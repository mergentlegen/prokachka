// Called by the existing Storage cleanup timer; no npm dependencies.
async function cleanupAnnouncementPhotos({ env = process.env, request = fetch } = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const base = new URL(env.NEXT_PUBLIC_SUPABASE_URL || 'https://missing.invalid');
  if (!key || base.protocol !== 'https:' || base.hostname.endsWith('.invalid')) throw new Error('Configure HTTPS Supabase URL and service-role key');
  const headers = { ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }), apikey: key, 'Content-Type': 'application/json' };
  async function rpc(name, body) {
    const response = await request(new URL(`/rest/v1/rpc/${name}`, base), {
      method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Announcement photo cleanup database operation failed: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  const jobs = await rpc('app_claim_announcement_photo_cleanup', { p_limit: 30 });
  let removed = 0, deferred = 0;
  for (const job of jobs || []) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}-(full|thumb)\.webp$/i.test(job.storage_path)) throw new Error('Invalid announcement photo cleanup path');
    let success = false;
    try {
      const response = await request(new URL('/storage/v1/object/announcement-photos', base), {
        method: 'DELETE', headers, body: JSON.stringify({ prefixes: [job.storage_path] }), redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      success = response.ok || response.status === 404;
    } catch { /* Keep the durable queue entry for retry. */ }
    await rpc('app_ack_announcement_photo_cleanup', { p_path: job.storage_path, p_lease: job.lease_token, p_success: success });
    if (success) removed++; else deferred++;
  }
  return { removed, deferred };
}
module.exports = { cleanupAnnouncementPhotos };
if (require.main === module) cleanupAnnouncementPhotos().then(result => {
  console.log(`Announcement photo cleanup: ${result.removed} removed, ${result.deferred} deferred`);
  if (result.deferred) process.exitCode = 1;
}).catch(error => { console.error(error.message); process.exitCode = 1; });
