const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const serverRoot = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['node_modules', 'client_dist']);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        walk(path.join(dir, entry.name));
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.join(dir, entry.name));
    }
  }
}

walk(serverRoot);
files.sort();

let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    failed = true;
    const relativePath = path.relative(serverRoot, file);
    console.error(`Syntax check failed: ${relativePath}`);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Syntax checked ${files.length} server JavaScript files.`);
