import type { AuthInfo, ReadinessCheck } from '../app/context'
import { buildApp } from '../app/build'
import { createTestDb, type Db } from '../db/client'
import { learnerAccess, learners, users } from '../db/schema'
import { CoreEnv } from '../config/env'
import { LearnerProfileInput } from '../../shared/contracts'

export const TEST_ENV = CoreEnv.parse({
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'pglite://memory',
  SESSION_SECRET: 'x'.repeat(40),
})

/** App on an in-process database. Tests choose the principal via the `x-test-auth` JSON header. */
export async function createTestApp(opts: { readiness?: ReadinessCheck[] } = {}) {
  const handle = await createTestDb()
  const app = await buildApp({ ctx: { env: TEST_ENV, db: handle.db, readiness: opts.readiness ?? [] } })
  app.addHook('onRequest', async (req) => {
    const h = req.headers['x-test-auth']
    if (typeof h === 'string') req.auth = JSON.parse(h) as AuthInfo
  })
  return { app, db: handle.db, close: async () => (await app.close(), await handle.close()) }
}

export async function seedUser(db: Db, name = 'Förälder') {
  const [u] = await db
    .insert(users)
    .values({ oidcIssuer: 'test', oidcSubject: crypto.randomUUID(), displayName: name })
    .returning()
  return u!
}

export async function seedLearner(db: Db, ownerId: string, school = { stage: 'grundskola', year: 1 } as const) {
  const profile = LearnerProfileInput.parse({ displayName: 'Jack', school })
  const [l] = await db.insert(learners).values({ profile }).returning()
  await db.insert(learnerAccess).values({ learnerId: l!.id, userId: ownerId, role: 'owner' })
  return l!
}

export const asAdult = (userId: string) => ({ 'x-test-auth': JSON.stringify({ userId, mode: 'adult' }) })
export const asLearner = (userId: string, learnerId: string) => ({
  'x-test-auth': JSON.stringify({ userId, mode: 'learner', activeLearnerId: learnerId }),
})
