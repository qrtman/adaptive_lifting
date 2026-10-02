/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { coexistenceProxy, createLegacyInsightSyncMiddleware } from './deploy/coexistenceProxy';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), {
      name: 'legacy-insight-card-sync',
      configureServer(server) {
        server.middlewares.use(createLegacyInsightSyncMiddleware(process.env.API_PROXY_TARGET || 'http://localhost:8000'));
      },
    }],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}'],
    },
    server: {
      // Disable HMR in hosted preview sessions with DISABLE_HMR=true.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Keep browser API requests same-origin. HTTP streaming responses such as
      // SSE are proxied as a stream by Vite's HTTP proxy.
      proxy: coexistenceProxy(
        process.env.API_PROXY_TARGET || 'http://localhost:8000',
        process.env.API_EDGE_TARGET,
      ),
    },
  };
});
