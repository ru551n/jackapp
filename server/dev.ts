// Development / e2e runner: app + worker in ONE process on an in-process Postgres (PGlite, stored
// in DATA_DIR/pglite). No Docker needed. AI defaults to the mock provider unless AI_* is set.
// Production always uses compose (separate app/worker containers + PostgreSQL).
//   npm run dev:all        (then `npm run dev` for the web app; Vite proxies /api)
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pino } from 'pino'
import { createAi } from './ai'
import { devMockText } from './ai/dev-mock'
import { buildApp } from './app/build'
import { CoreEnv, parseEnv } from './config/env'
import { syncBundledCurriculum } from './curriculum/service'
import type { Db } from './db/client'
import { MIGRATIONS_DIR } from './db/migrations'
import * as schema from './db/schema'
import { createWorker, jobsServices } from './jobs'
import { loadArtifactVersion } from './generation/store'
import { jobHandlers } from './worker/handlers'

if (process.env.NODE_ENV === 'production') throw new Error('server/dev.ts is for development only')
const defaults: Record<string, string> = {
  NODE_ENV: 'development',
  PUBLIC_URL: 'http://localhost:5173',
  DATABASE_URL: 'pglite',
  APP_SECRET: 'dev-only-secret-dev-only-secret-dev-only',
  DATA_DIR: '.dev-data',
  AI_TEXT_PROVIDER: 'mock',
  AI_VISION_PROVIDER: 'mock',
}
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'dev' } })
const env = parseEnv(CoreEnv)
mkdirSync(env.DATA_DIR, { recursive: true })

const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
  import('@electric-sql/pglite'),
  import('drizzle-orm/pglite'),
  import('drizzle-orm/pglite/migrator'),
])
const client = new PGlite(process.env.PGLITE_DIR ?? join(env.DATA_DIR, 'pglite'))
const db = drizzle(client, { schema }) as unknown as Db
await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR })
await syncBundledCurriculum(db, log)

// Mock providers get a scripted model that writes valid (approvable) material.
const ai = createAi(process.env, { db, log, mock: { text: devMockText } })
const jobs = jobsServices({ db })
const handlers = jobHandlers({ db, env, ai, log })
const worker = createWorker({ db, log, handlers, concurrency: 2, pollMs: 500 })
await worker.start()

const app = await buildApp({
  ctx: { env, db, readiness: [...ai.readiness, ...jobs.readiness], ai, jobs, loadArtifactVersion },
  logger: { level: 'warn' },
})
await app.listen({ port: env.PORT, host: '127.0.0.1' })
log.info({ port: env.PORT, ai: ai.status().map((s) => `${s.capability}:${s.configured}`) }, 'dev server ready')

const stop = async () => {
  await worker.stop(5000)
  await app.close()
  await client.close()
  process.exit(0)
}
process.once('SIGINT', () => void stop())
process.once('SIGTERM', () => void stop())
