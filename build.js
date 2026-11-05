// Copies the deployable files into ./dist (no dependencies, just: node build.js).
// dist/ is what gets published. The GitHub Actions workflow runs this on every push.
const fs = require('fs');
const path = require('path');

const FILES = ['index.html', 'style.css', 'game.js', 'manifest.webmanifest', 'sw.js', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const out = path.join(__dirname, 'dist');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of FILES) fs.copyFileSync(path.join(__dirname, f), path.join(out, f));

// Give every build its own service-worker cache name (commit id in CI, timestamp locally),
// so players' browsers always drop the old cached copy and pick up the new version.
const buildId = (process.env.GITHUB_SHA || String(Date.now())).slice(0, 7);
const swPath = path.join(out, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
const stamped = sw.replace(/const CACHE = '[^']*';/, `const CACHE = 'pit-wall-${buildId}';`);
if (stamped === sw) throw new Error('Could not find the CACHE line in sw.js to stamp');
fs.writeFileSync(swPath, stamped);

const kb = FILES.reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0) / 1024;
console.log(`dist/ ready: ${FILES.length} files, ${kb.toFixed(0)} KB, cache pit-wall-${buildId}`);
