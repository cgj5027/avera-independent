import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const fixturePath=path=>fileURLToPath(new URL(path,import.meta.url));
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@/api/application':fixturePath('./tests/fixtures/application.js'), 'npm:@base44/sdk@0.8.53':fixturePath('./tests/backendSdk.js'), 'base44:runtime':fixturePath('./tests/backendRuntime.js'), '@':fixturePath('./src') } },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.js'], exclude: [...configDefaults.exclude,'**/*.node.test.ts'] },
});
