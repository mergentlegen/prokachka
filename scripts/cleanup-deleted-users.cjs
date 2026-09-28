// Invoked by the existing Storage cleanup timer. No npm dependencies.
async function cleanupDeletedUsers({ env = process.env, request = fetch } = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const base = new URL(env.NEXT_PUBLIC_SUPABASE_URL || 'https://missing.invalid');
  if (!key || base.protocol !== 'https:' || base.hostname.endsWith('.invalid')) throw new Error('Configure HTTPS Supabase URL and service-role key');
  const headers = { ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }), apikey: key, 'Content-Type': 'application/json' };
  async function rpc(name, body) {
    const response = await request(new URL(`/rest/v1/rpc/${name}`, base), {
      method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Account cleanup database operation failed: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  let removed = 0, deferred = 0;
  const identities = await rpc('app_claim_user_cleanup', { p_limit: 20 });
  for (const job of identities || []) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(job.auth_user_id)) throw new Error('Invalid Auth cleanup ID');
    let success = false;
    try {
      const response = await request(new URL(`/auth/v1/admin/users/${job.auth_user_id}`, base), {
        method: 'DELETE', headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      success = response.ok || response.status === 404;
    } catch { /* Keep the durable job for retry. */ }
    await rpc('app_ack_user_cleanup', { p_auth_user_id: job.auth_user_id, p_lease: job.lease_token, p_success: success });
    if (success) removed++; else deferred++;
  }
  const attachments = await rpc('app_claim_task_attachment_cleanup', { p_limit: 30 });
  for (const job of attachments || []) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i.test(job.storage_path)) throw new Error('Invalid PDF cleanup path');
    let success = false;
    try {
      const response = await request(new URL('/storage/v1/object/task-attachments', base), {
        method: 'DELETE', headers, body: JSON.stringify({ prefixes: [job.storage_path] }),
        redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      success = response.ok || response.status === 404;
    } catch { /* Keep the durable job for retry. */ }
    await rpc('app_ack_task_attachment_cleanup', { p_path: job.storage_path, p_lease: job.lease_token, p_success: success });
    if (success) removed++; else deferred++;
  }
  return { removed, deferred };
}
module.exports = { cleanupDeletedUsers };
