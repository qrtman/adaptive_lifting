/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { edgeOnlyProxy } from './deploy/edgeOnlyProxy';
import { edgeTargetRequiredPlugin } from './deploy/edgeTargetRequired';

export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), '');
  const edgeTarget = process.env.API_EDGE_TARGET ?? loadedEnv.API_EDGE_TARGET;
  return {
    plugins: [edgeTargetRequiredPlugin(Boolean(edgeTarget)), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: { outDir: 'dist' },
    test: {
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}', 'cloudflare/**/*.test.ts'],
    },
    server: {
      // Disable HMR in hosted preview sessions with DISABLE_HMR=true.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Vite proxies all API paths to Supabase Edge when configured.
      proxy: edgeOnlyProxy(edgeTarget),
    },
  };
});
