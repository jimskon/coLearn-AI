// vite.config.mjs
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  // Use either DEV_REACT_BUILD=true or VITE_DEV_REACT_BUILD=true (both supported)
  const devBuild =
    process.env.DEV_REACT_BUILD === 'true' ||
    process.env.VITE_DEV_REACT_BUILD === 'true';

  let gitCommitCount = '0';
  try {
    gitCommitCount = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim();
  } catch {
    gitCommitCount = '0';
  }

  return {
    plugins: [react()],
    define: {
      __APP_GIT_COMMIT_COUNT__: JSON.stringify(gitCommitCount),
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
