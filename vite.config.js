import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.VITE_AVERA_BACKEND ?? 'base44';
  if (!['base44', 'http'].includes(backend)) throw new Error('Invalid VITE_AVERA_BACKEND.');
  const plugins = [react()];
  if (backend === 'base44') {
    const { default: base44 } = await import('@base44/vite-plugin');
    plugins.unshift(base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    }));
  }
  return {
    plugins,
    resolve: { alias: {
      ...(backend === 'http' ? { '@/api/application': fileURLToPath(new URL('./src/api/httpApplication.js', import.meta.url)) } : {}),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    } },
    build: { target: 'es2022', ...(backend === 'http' ? { outDir: 'dist-local' } : {}) },
  };
});
