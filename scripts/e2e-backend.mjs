// Real-backend e2e server (Playwright `platform` project): server/dev.ts (app + worker + PGlite) on a
// fresh temp DATA_DIR, with text and vision AI over the real OpenAI-compatible HTTP adapter against
// scripts/mock-openai.ts (dev mock content, plus grounded items for strict study tests). The web app is
// built (no speech) into that dir and served by `vite preview` with /api proxied, so it never races
// the mocked projects' `dist`.
// ponytail: dev.ts does not serve WEB_DIST_DIR, so vite preview fronts it; drop the proxy once it does.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, preview } from 'vite'

const port = Number(process.env.E2E_PLATFORM_PORT ?? 4310)
const apiPort = port + 1
const dataDir = mkdtempSync(join(tmpdir(), 'jackapp-e2e-'))
const outDir = join(dataDir, 'dist')
await build({ logLevel: 'warn', build: { outDir, emptyOutDir: true } })

const aiPort = port + 2
const ai = spawn(process.execPath, ['--import', 'tsx', 'scripts/mock-openai.ts'], {
  stdio: 'inherit',
  env: { ...process.env, MOCK_AI_PORT: String(aiPort) },
})
const aiUrl = `http://127.0.0.1:${aiPort}/v1`
const api = spawn(process.execPath, ['--import', 'tsx', 'server/dev.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development', // vite build sets production in this process
    PORT: String(apiPort),
    PUBLIC_URL: `http://localhost:${port}`,
    DATA_DIR: dataDir,
    PGLITE_DIR: join(dataDir, 'pglite'),
    ...Object.fromEntries(
      ['TEXT', 'VISION'].flatMap((c) => [
        [`AI_${c}_PROVIDER`, 'openai-compatible'],
        [`AI_${c}_BASE_URL`, aiUrl],
        [`AI_${c}_MODEL`, 'mock'],
      ]),
    ),
    ALLOW_LOCAL_AI: 'true',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
  },
})

const stop = (code = 0) => {
  api.kill('SIGTERM')
  ai.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
  process.exit(code)
}
for (const p of [api, ai]) p.on('exit', (code) => stop(code ?? 1))
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

// Wait for the API before exposing the port Playwright polls.
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${apiPort}/health`)).ok) break
  } catch {}
  if (i > 600) stop(1)
  await new Promise((r) => setTimeout(r, 200))
}

await preview({
  build: { outDir },
  preview: {
    port,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
})
console.log(`e2e platform ready on http://localhost:${port}`)
