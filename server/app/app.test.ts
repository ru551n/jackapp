import { afterEach, describe, expect, it } from 'vitest'
import { HttpError, requireAdult, requireLearner } from '../gate/guards'
import { createTestApp, seedLearner } from '../test/helpers'
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

describe('adult gate guards', () => {
  it('requireAdult refuses without the gate; requireLearner 404s unknown learners', async () => {
    const t = await createTestApp()
    close = t.close
    const req = (gate?: object) => ({ gate }) as unknown as FastifyRequest
    expect(() => requireAdult(req())).toThrow(HttpError)
    expect(() => requireAdult(req({ adult: true }))).not.toThrow()
    const l = await seedLearner(t.db)
    await expect(requireLearner(t.db, l.id)).resolves.toMatchObject({ id: l.id })
    await expect(requireLearner(t.db, crypto.randomUUID())).rejects.toMatchObject({ status: 404 })
  })
})
