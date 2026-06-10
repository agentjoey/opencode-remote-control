import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit()],
  // Local-dev proxy: forward /api + /ws to the running plugin on :7081 so the
  // dev server (5174) sees real sessions/data. Requires WEB_CF_ACCESS_DEV_BYPASS
  // on the plugin (the proxy connects from loopback). Dev-only; harmless in prod.
  server: {
    proxy: {
      '/api': { target: 'http://localhost:7081', changeOrigin: true },
      '/ws': { target: 'ws://localhost:7081', ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,ts}'],
  },
  resolve: {
    conditions: ['browser'],
  },
})
