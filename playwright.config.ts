import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 4173)
// Real backend (scripts/e2e-backend.mjs): dev server + PGlite + dev mock AI, fresh data per run.
const platformPort = Number(process.env.E2E_PLATFORM_PORT ?? 4310)
const tablet = { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 }, hasTouch: true }

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'tablet', testIgnore: /platform\.spec/, use: tablet },
    { name: 'phone', testIgnore: /platform\.spec/, use: { ...devices['Pixel 7'] } },
    {
      name: 'platform',
      testMatch: /platform\.spec/,
      fullyParallel: false,
      workers: 1,
      timeout: 90_000,
      use: { ...tablet, baseURL: `http://localhost:${platformPort}` },
    },
  ],
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${port} --strictPort`,
      port,
      reuseExistingServer: true,
      timeout: 300_000, // speech synthesis on a cold cache
    },
    {
      command: 'node scripts/e2e-backend.mjs',
      url: `http://localhost:${platformPort}/api/v1/gate`,
      env: { E2E_PLATFORM_PORT: String(platformPort), JACKAPP_SKIP_SPEECH: '1' },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
