import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const fixturePath=path=>fileURLToPath(new URL(path,import.meta.url));
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@/api/application':fixturePath('./tests/fixtures/application.js'), 'test:service-client':fixturePath('./tests/fixtures/service-client.js'), 'test:service-runtime':fixturePath('./tests/fixtures/service-runtime.js'), '@':fixturePath('./src') } },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.js'], exclude: [...configDefaults.exclude,'**/*.node.test.ts'] },
});
