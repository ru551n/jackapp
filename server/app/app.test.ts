import { afterEach, describe, expect, it } from 'vitest'
import { requireLearner } from '../auth/guards'
import { createTestApp, seedLearner, seedUser } from '../test/helpers'
import type { FastifyRequest } from 'fastify'

let close: (() => Promise<void>) | undefined
afterEach(async () => close?.())

describe('app skeleton', () => {
  it('serves health and readiness', async () => {
    const t = await createTestApp({
      readiness: [
        { name: 'database', critical: true, check: async () => ({ ok: true }) },
        { name: 'images', critical: false, check: async () => ({ ok: false, detail: 'not configured' }) },
      ],
    })
    close = t.close
    expect((await t.app.inject('/health')).statusCode).toBe(200)
    const ready = await t.app.inject('/ready')
    expect(ready.statusCode).toBe(200)
    expect(ready.json().checks).toHaveLength(2)
  })

  it('is not ready when a critical check fails', async () => {
    const t = await createTestApp({
      readiness: [{ name: 'ai.text', critical: true, check: async () => ({ ok: false }) }],
    })
    close = t.close
    expect((await t.app.inject('/ready')).statusCode).toBe(503)
  })
})

describe('learner authorization', () => {
  it('allows owners, hides learners from others, limits learner mode', async () => {
    const t = await createTestApp()
    close = t.close
    const owner = await seedUser(t.db)
    const other = await seedUser(t.db, 'Granne')
    const l = await seedLearner(t.db, owner.id)
    const req = (auth: object) => ({ auth }) as unknown as FastifyRequest
    await expect(
      requireLearner(req({ userId: owner.id, mode: 'adult' }), t.db, l.id, { min: 'owner' }),
    ).resolves.toBeTruthy()
    await expect(requireLearner(req({ userId: other.id, mode: 'adult' }), t.db, l.id)).rejects.toMatchObject({
      status: 404,
    })
    await expect(
      requireLearner(req({ userId: owner.id, mode: 'learner', activeLearnerId: l.id }), t.db, l.id),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      requireLearner(req({ userId: owner.id, mode: 'learner', activeLearnerId: l.id }), t.db, l.id, {
        allowLearnerMode: true,
      }),
    ).resolves.toBeTruthy()
  })
})
