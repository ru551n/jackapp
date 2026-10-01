import type { ReadinessCheck } from '../app/context'
import { buildApp } from '../app/build'
import { createTestDb, type Db } from '../db/client'
import { learners } from '../db/schema'
import { CoreEnv } from '../config/env'
import { LearnerProfileInput, type SchoolPosition } from '../../shared/contracts'
import { storePin } from '../gate/pin'

export const TEST_ENV = CoreEnv.parse({
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'pglite://memory',
  APP_SECRET: 'x'.repeat(40),
})

export const TEST_PIN = '2468'

/**
 * App on an in-process database. Tests unlock the adult gate with the `x-test-adult: 1` header.
 * A household PIN (TEST_PIN) is set so the gate is closed by default; `pin: null` = first run.
 */
export async function createTestApp(opts: { readiness?: ReadinessCheck[]; pin?: string | null } = {}) {
  const handle = await createTestDb()
  if (opts.pin !== null) await storePin(handle.db, opts.pin ?? TEST_PIN)
  const app = await buildApp({ ctx: { env: TEST_ENV, db: handle.db, readiness: opts.readiness ?? [] } })
  app.addHook('onRequest', async (req) => {
    if (req.headers['x-test-adult'] === '1') req.gate = { adult: true }
  })
  return { app, db: handle.db, close: async () => (await app.close(), await handle.close()) }
}

export async function seedLearner(db: Db, school: SchoolPosition = { stage: 'grundskola', year: 1 }) {
  const profile = LearnerProfileInput.parse({ displayName: 'Jack', school })
  const [l] = await db.insert(learners).values({ profile }).returning()
  return l!
}

export const asAdult = { 'x-test-adult': '1' }
