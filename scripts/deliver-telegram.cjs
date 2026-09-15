// Run from the app directory: node --env-file=.env.local scripts/deliver-telegram.cjs
// Intended for a once-per-minute server timer. No tokens are printed.
async function main() {
  const secret = process.env.TELEGRAM_DELIVERY_SECRET;
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  if (!secret || secret.length < 32 || !origin) throw new Error('Configure TELEGRAM_DELIVERY_SECRET and NEXT_PUBLIC_APP_URL');
  const url = new URL('/api/internal/telegram/deliver', origin);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('HTTPS is required');
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${secret}` },
    redirect: 'error', signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Delivery worker returned HTTP ${response.status}`);
  const result = await response.json();
  if (result.failed) console.warn(`Telegram notifications deferred: ${result.failed}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
