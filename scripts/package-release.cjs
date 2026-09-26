// Run after a standalone build in the clean Linux CI checkout (without .env files).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { copyReleaseTree, assertPortableRelease } = require('./release-files.cjs');

const root = path.resolve(__dirname, '..');
const release = process.env.PROKACHKA_RELEASE_ID;
if (!/^[a-f0-9]{40}-\d+-\d+$/.test(release || '')) throw new Error('Invalid release ID');
const source = path.join(root, '.next/standalone');
if (!fs.existsSync(path.join(source, 'server.js'))) throw new Error('Standalone build is missing');

const destination = path.join(root, '.next/release');
fs.mkdirSync(destination); // Refuse to mix builds or overwrite an existing release.
copyReleaseTree(source, destination, root);
copyReleaseTree(path.join(root, 'public'), path.join(destination, 'public'), root);
copyReleaseTree(path.join(root, '.next/static'), path.join(destination, '.next/static'), root);
fs.mkdirSync(path.join(destination, 'scripts'));
for (const file of ['start-release.cjs', 'smoke-test.cjs', 'deliver-telegram.cjs', 'cleanup-welcome-videos.cjs', 'cleanup-profile-avatars.cjs']) {
  fs.copyFileSync(path.join(root, 'scripts', file), path.join(destination, 'scripts', file));
}
const metadata = {
  release,
  nodeMajor: Number(process.versions.node.split('.')[0]),
  platform: process.platform,
  arch: process.arch,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
};
fs.writeFileSync(path.join(destination, 'release.json'), JSON.stringify(metadata) + '\n');
assertPortableRelease(destination);
const artifactDir = path.join(root, '.next/artifact');
fs.mkdirSync(artifactDir);
execFileSync('tar', ['-czf', path.join(artifactDir, 'release.tar.gz'), '-C', destination, '.']);
console.log('Packaged release: ' + release);
