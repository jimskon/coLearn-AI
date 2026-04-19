// vite.config.mjs
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  // Use either DEV_REACT_BUILD=true or VITE_DEV_REACT_BUILD=true (both supported)
  const devBuild =
    process.env.DEV_REACT_BUILD === 'true' ||
    process.env.VITE_DEV_REACT_BUILD === 'true';

  return {
    plugins: [react()],
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
