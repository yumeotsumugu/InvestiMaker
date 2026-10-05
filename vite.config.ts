import { defineConfig } from 'vitest/config';

// assets/ をそのまま静的配信する（/development/<Part ID>/manifest.json など）。
export default defineConfig({
  publicDir: 'assets',
  server: { host: '127.0.0.1' },
  build: { outDir: 'dist', assetsDir: '_app', rollupOptions: { input: ['dev.html', 'minimal.html', 'lab.html'] } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
