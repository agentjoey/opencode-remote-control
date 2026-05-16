import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

export default defineConfig({
  plugins: [svelte({ compilerOptions: { generate: 'client' } })],
  build: {
    outDir: 'extension-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'extension/background.ts'),
        sidepanel: resolve(__dirname, 'extension/sidepanel-entry.ts'),
        popup: resolve(__dirname, 'extension/popup.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].[hash].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
  resolve: {
    conditions: ['browser'],
  },
})
