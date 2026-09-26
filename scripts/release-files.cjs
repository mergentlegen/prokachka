const fs = require('node:fs');
const path = require('node:path');

function isInside(root, filename) {
  const relative = path.relative(root, filename);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

// Turbopack emits hashed external-package symlinks under .next/node_modules.
// A release must not rely on the CI checkout (even if smoke checks can still see
// it). Materialize every link explicitly, including directory junctions, so the
// archive is self-contained when moved to a different machine.
function copyReleaseTree(source, destination, buildRoot) {
  const allowed = fs.realpathSync(buildRoot);
  function copy(input, output, ancestors) {
    const name = path.basename(input);
    if (name === '.env' || name.startsWith('.env.')) throw new Error('Refusing to package an environment file');
    const real = fs.realpathSync(input); // Broken links fail the build, not production.
    if (!isInside(allowed, real)) throw new Error('Release dependency points outside the build root: ' + input);
    const stat = fs.statSync(real);
    if (stat.isDirectory()) {
      if (ancestors.has(real)) throw new Error('Circular release dependency: ' + input);
      const next = new Set(ancestors).add(real);
      fs.mkdirSync(output, { recursive: true });
      for (const entry of fs.readdirSync(real)) copy(path.join(real, entry), path.join(output, entry), next);
    } else if (stat.isFile()) {
      // Public assets may already have been traced into standalone; copying the
      // complete public/static trees intentionally fills in and replaces them.
      fs.copyFileSync(real, output);
    } else {
      throw new Error('Unsupported release file: ' + input);
    }
  }
  copy(source, destination, new Set());
}

function assertPortableRelease(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Release contains a non-portable link: ' + filename);
    if (entry.name === '.env' || entry.name.startsWith('.env.')) throw new Error('Release contains an environment file');
    if (entry.isDirectory()) assertPortableRelease(filename);
  }
}

module.exports = { copyReleaseTree, assertPortableRelease };
