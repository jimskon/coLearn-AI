import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const versionFile = resolve(projectRoot, 'VERSION');
const packageFiles = [
  resolve(projectRoot, 'package.json'),
  resolve(projectRoot, 'client/package.json'),
  resolve(projectRoot, 'server/package.json'),
];

export function incrementVersion(currentVersion, kind = 'patch') {
  const match = String(currentVersion).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`VERSION must use major.minor.patch format; received "${currentVersion}".`);

  let [major, minor, patch] = match.slice(1).map(Number);
  if (kind === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === 'minor') {
    minor += 1;
    patch = 0;
  } else if (kind === 'patch') {
    patch += 1;
  } else {
    throw new Error('Usage: npm run version:patch | version:minor | version:major');
  }
  return `${major}.${minor}.${patch}`;
}

function writeJsonVersion(filePath, version) {
  const packageJson = JSON.parse(readFileSync(filePath, 'utf8'));
  packageJson.version = version;
  writeFileSync(filePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function main() {
  const kind = process.argv[2] || 'patch';
  const currentVersion = readFileSync(versionFile, 'utf8').trim();
  const nextVersion = incrementVersion(currentVersion, kind);

  writeFileSync(versionFile, `${nextVersion}\n`);
  packageFiles.forEach((filePath) => writeJsonVersion(filePath, nextVersion));
  console.log(`Release version bumped: ${currentVersion} → ${nextVersion}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
