// vite.config.mjs
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  const clientDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
  const projectRoot = resolve(clientDir, '..');
  // Use either DEV_REACT_BUILD=true or VITE_DEV_REACT_BUILD=true (both supported)
  const devBuild =
    process.env.DEV_REACT_BUILD === 'true' ||
    process.env.VITE_DEV_REACT_BUILD === 'true';

  let gitCommitSha = 'unknown';
  try {
    gitCommitSha = execSync('git rev-parse --short=7 HEAD', {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    // The release version remains useful when a source archive has no Git data.
  }
  const releaseVersion = readFileSync(resolve(projectRoot, 'VERSION'), 'utf8').trim();
  const buildTimeUtc = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');

  return {
    plugins: [react()],
    define: {
      __APP_RELEASE_VERSION__: JSON.stringify(releaseVersion),
      __APP_BUILD_TIME_UTC__: JSON.stringify(buildTimeUtc),
      __APP_GIT_COMMIT_SHA__: JSON.stringify(gitCommitSha),
    },
    server: {
      host: true,
      port: 3000,
    },
    build: {
      sourcemap: devBuild,
      minify: devBuild ? false : 'esbuild',
    },
  };
});
