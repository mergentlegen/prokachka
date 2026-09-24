const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

function validateRuntime(metadata, env, ci = false) {
  if (metadata.platform !== process.platform || metadata.arch !== process.arch ||
      metadata.nodeMajor !== Number(process.versions.node.split('.')[0])) {
    throw new Error('Release requires the same OS, architecture and Node.js major as CI (Linux x64, Node 22).');
  }
  if (!/^[a-f0-9]{40}-\d+-\d+$/.test(metadata.release || '')) throw new Error('Invalid release ID');
  if (ci) return;
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new Error('AUTH_SECRET must contain at least 32 characters');
  if (env.AUTH_DEV_MODE === 'true') throw new Error('AUTH_DEV_MODE must be false in production');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  for (const [field, variable] of [['appUrl', 'NEXT_PUBLIC_APP_URL'], ['supabaseUrl', 'NEXT_PUBLIC_SUPABASE_URL']]) {
    if (!metadata[field] || metadata[field] !== env[variable]) {
      throw new Error(variable + ' differs from the build. Update the GitHub repository variable and rebuild.');
    }
  }
  if (!['https://prokachka.kz', 'https://www.prokachka.kz'].includes(metadata.appUrl)) {
    throw new Error('NEXT_PUBLIC_APP_URL must match the production Host allowlist');
  }
  const supabaseUrl = new URL(metadata.supabaseUrl);
  if (supabaseUrl.protocol !== 'https:' || supabaseUrl.hostname.endsWith('.invalid')) {
    throw new Error('Configure a real HTTPS Supabase URL before deploying');
  }
}

function main() {
  const root = path.resolve(__dirname, '..');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
  const [envFile, port = '3000', mode] = process.argv.slice(2);
  const ci = envFile === '--ci';
  const env = ci ? { AUTH_SECRET: 'ci-only-not-a-production-secret-000000000', AUTH_DEV_MODE: 'false' }
    : parseEnv(fs.readFileSync(envFile, 'utf8'));
  validateRuntime(metadata, env, ci);
  if (mode === '--check') return;
  if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw new Error('Invalid application port');
  Object.assign(process.env, env, {
    NODE_ENV: 'production', AUTH_DEV_MODE: 'false', HOSTNAME: '127.0.0.1', PORT: port,
    PROKACHKA_RELEASE_ID: metadata.release,
  });
  process.chdir(root);
  require(path.join(root, 'server.js'));
}

module.exports = { validateRuntime };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
