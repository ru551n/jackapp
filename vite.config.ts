/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

// The espeak-ng phonemizer ships as a CommonJS/UMD script; expose it as an ES module default export.
const phonemizerEsm = (): Plugin => ({
  name: 'piper-phonemize-esm',
  enforce: 'pre',
  load(id) {
    if (!id.split('?')[0]!.endsWith('/piper_phonemize.js')) return
    const src = readFileSync(id.split('?')[0]!, 'utf8').replace(/if \(typeof exports[\s\S]*$/, '')
    return `${src}\nexport default createPiperPhonemize`
  },
})

export default defineConfig({
  plugins: [react(), phonemizerEsm()],
  worker: { format: 'es', plugins: () => [phonemizerEsm()] },
  // Prebuilt wasm assets: do not pre-bundle (dev).
  optimizeDeps: { exclude: ['onnxruntime-web', '@diffusionstudio/piper-wasm'] },
  // Relative asset paths: the build works from any folder or static host.
  base: './',
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
})
