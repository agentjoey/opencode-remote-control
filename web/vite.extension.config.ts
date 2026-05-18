import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'
import { dirname } from 'path'

function extensionManifestPlugin() {
  return {
    name: 'extension-manifest',
    writeBundle() {
      const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'))
      const manifest = JSON.parse(readFileSync(resolve(__dirname, 'extension/manifest.json'), 'utf-8'))
      manifest.version = rootPkg.version
      const outDir = resolve(__dirname, 'extension-dist')
      mkdirSync(outDir, { recursive: true })
      writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
      // Copy static HTML files
      ;['sidepanel.html', 'popup.html'].forEach((f) => {
        copyFileSync(resolve(__dirname, 'extension', f), resolve(outDir, f))
      })
      // Copy icons
      mkdirSync(resolve(outDir, 'icons'), { recursive: true })
      ;['16.png', '32.png', '128.png'].forEach((f) => {
        copyFileSync(resolve(__dirname, 'extension/icons', f), resolve(outDir, 'icons', f))
      })
    },
  }
}

export default defineConfig({
  plugins: [svelte({ compilerOptions: { generate: 'client' } }), extensionManifestPlugin()],
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
