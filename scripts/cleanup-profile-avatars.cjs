// Used by the existing Storage cleanup timer. No application/npm dependencies.
async function cleanupAvatars({ env = process.env, request = fetch } = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const base = new URL(env.NEXT_PUBLIC_SUPABASE_URL || 'https://missing.invalid');
  if (!key || base.protocol !== 'https:' || base.hostname.endsWith('.invalid')) throw new Error('Configure HTTPS Supabase URL and service-role key');
  const headers = { ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }), apikey: key, 'Content-Type': 'application/json' };
  async function rpc(name, body) {
    const response = await request(new URL(`/rest/v1/rpc/${name}`, base), {
      method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Avatar cleanup database operation failed: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  const jobs = await rpc('app_claim_profile_avatar_cleanup', { p_limit: 30 });
  let removed = 0, deferred = 0;
  for (const job of jobs || []) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(job.storage_path)) throw new Error('Invalid avatar cleanup path');
    let status = 0;
    try {
      const response = await request(new URL('/storage/v1/object/profile-avatars', base), {
        method: 'DELETE', headers, body: JSON.stringify({ prefixes: [job.storage_path] }), redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
    } catch { /* Retry later; do not discard the durable queue entry. */ }
    await rpc('app_ack_profile_avatar_cleanup', { p_path: job.storage_path, p_lease: job.lease_token, p_status: status });
    if (status >= 200 && status < 300 || status === 404) removed++; else deferred++;
  }
  return { removed, deferred };
}
module.exports = { cleanupAvatars };
if (require.main === module) cleanupAvatars().then(result => {
  console.log(`Avatar cleanup: ${result.removed} removed, ${result.deferred} deferred`);
  if (result.deferred) process.exitCode = 1;
}).catch(error => { console.error(error.message); process.exitCode = 1; });
