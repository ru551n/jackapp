import type { ReadinessCheck } from '../app/context'
import { buildApp } from '../app/build'
import { createTestDb, type Db } from '../db/client'
import { learners } from '../db/schema'
import { CoreEnv } from '../config/env'
import { LearnerProfileInput } from '../../shared/contracts'

export const TEST_ENV = CoreEnv.parse({
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'pglite://memory',
  APP_SECRET: 'x'.repeat(40),
})

/** App on an in-process database. Tests unlock the adult gate with the `x-test-adult: 1` header. */
export async function createTestApp(opts: { readiness?: ReadinessCheck[] } = {}) {
  const handle = await createTestDb()
  const app = await buildApp({ ctx: { env: TEST_ENV, db: handle.db, readiness: opts.readiness ?? [] } })
  app.addHook('onRequest', async (req) => {
    if (req.headers['x-test-adult'] === '1') req.gate = { adult: true }
  })
  return { app, db: handle.db, close: async () => (await app.close(), await handle.close()) }
}

export async function seedLearner(db: Db, school = { stage: 'grundskola', year: 1 } as const) {
  const profile = LearnerProfileInput.parse({ displayName: 'Jack', school })
  const [l] = await db.insert(learners).values({ profile }).returning()
  return l!
}

export const asAdult = { 'x-test-adult': '1' }
