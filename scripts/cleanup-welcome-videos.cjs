// Node 22+, no npm dependencies. Use the production env file; never log URLs/tokens.
// node --env-file=/var/www/prokachka/.env.production scripts/cleanup-welcome-videos.cjs
async function cleanup({ env = process.env, request = fetch } = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const base = new URL(env.NEXT_PUBLIC_SUPABASE_URL || 'https://missing.invalid');
  if (!key || base.protocol !== 'https:' || base.hostname.endsWith('.invalid')) throw new Error('Configure HTTPS Supabase URL and service-role key');
  const headers = { ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }), apikey: key, 'Content-Type': 'application/json' };
  async function rpc(name, body) {
    const response = await request(new URL(`/rest/v1/rpc/${name}`, base), {
      method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Cleanup database operation failed: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  const jobs = await rpc('app_claim_welcome_video_cleanup', { p_limit: 10 });
  let removed = 0, deferred = 0;
  for (const job of jobs || []) {
    // Defence in depth: never delete another bucket or an arbitrary path from a queue.
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/i.test(job.storage_path)) throw new Error('Invalid welcome-video cleanup path');
    let status = 0;
    try {
      const response = await request(new URL('/storage/v1/object/welcome-videos', base), {
        method: 'DELETE', headers, body: JSON.stringify({ prefixes: [job.storage_path] }),
        redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
    } catch { /* retry later, keeping the durable queue entry */ }
    await rpc('app_ack_welcome_video_cleanup', { p_path: job.storage_path, p_lease: job.lease_token, p_status: status });
    if (status >= 200 && status < 300 || status === 404) removed++; else deferred++;
  }
  return { removed, deferred };
}
module.exports = { cleanup };
if (require.main === module) Promise.all([cleanup(), require('./cleanup-profile-avatars.cjs').cleanupAvatars()]).then(results => {
  for (const [index, { removed, deferred }] of results.entries()) {
    console.log(`${index ? 'Avatar' : 'Welcome video'} cleanup: ${removed} removed, ${deferred} deferred`);
    if (deferred) process.exitCode = 1;
  }
}).catch(error => { console.error(error.message); process.exitCode = 1; });
