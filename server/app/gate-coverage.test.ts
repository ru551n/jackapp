import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { API_PREFIX } from '../../shared/contracts'
import { eq } from 'drizzle-orm'
import { learners } from '../db/schema'
import { createTestApp, seedLearner } from '../test/helpers'

// Every mutating /api/v1 route needs the adult gate (PIN set, no gate cookie → 403), except the
// learner-facing routes below. A new route fails here until it calls requireAdult or is allowlisted.

const routes = vi.hoisted(() => [] as { method: string; url: string }[])
vi.mock('fastify', async (importOriginal) => {
  const mod = await importOriginal<typeof import('fastify')>()
  const wrapped = (opts?: object) => {
    const app = mod.default(opts)
    app.addHook('onRoute', (r) => {
      for (const method of [r.method].flat()) routes.push({ method, url: r.url })
    })
    return app
  }
  return { ...mod, default: wrapped }
})

/**
 * Learner-reachable mutations (`METHOD path` relative to API_PREFIX). `conditional` routes are only
 * open for some learners; for an early learner without learner requests they must still be 403.
 */
const ALLOWLIST: Record<string, { why: string; conditional?: boolean }> = {
  'POST /gate/pin': { why: 'first run creates the PIN; changing it needs the adult cookie (gate plugin)' },
  'POST /gate/unlock': { why: 'opens the gate with the PIN' },
  'POST /gate/lock': { why: 'anyone may close the gate' },
  'POST /learners/:id/runs': { why: 'learner starts a run of approved material' },
  'POST /learners/:id/runs/:runId/answers': { why: 'learner answers' },
  'POST /learners/:id/runs/:runId/hint': { why: 'learner asks for a hint' },
  'POST /learners/:id/runs/:runId/finish': { why: 'learner finishes a run' },
  'POST /learners/:id/runs/:runId/abandon': { why: 'learner leaves a run' },
  'POST /learners/:id/generate': { why: 'learner request, if the profile allows it', conditional: true },
  'POST /learners/:id/paths': { why: 'learner path request, if the profile allows it', conditional: true },
  'POST /learners/:id/study-sets': {
    why: 'middle/upper learner upload, if the profile allows learner requests',
    conditional: true,
  },
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])
const OTHER_ID = '00000000-0000-4000-8000-000000000001'

describe('adult gate coverage', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>
  let learnerId: string
  let mutating: string[]
  beforeAll(async () => {
    t = await createTestApp()
    // Early band with learner requests off: the conditional routes must stay closed.
    const l = await seedLearner(t.db)
    learnerId = l.id
    const profile = { ...l.profile, generation: { ...l.profile.generation, learnerRequestsAllowed: false } }
    await t.db.update(learners).set({ profile }).where(eq(learners.id, l.id))
    mutating = [
      ...new Set(
        routes
          .filter((r) => r.url.startsWith(API_PREFIX) && !SAFE.has(r.method))
          .map((r) => `${r.method} ${r.url.slice(API_PREFIX.length)}`),
      ),
    ].sort()
  })
  afterAll(() => t.close())

  const call = (key: string) => {
    const [method, path] = key.split(' ') as [string, string]
    const url = API_PREFIX + path.replace(/^\/learners\/:id/, `/learners/${learnerId}`).replace(/:\w+/g, OTHER_ID)
    return t.app.inject({ method: method as 'POST', url, payload: {} })
  }

  it('found the routes', () => {
    expect(mutating.length).toBeGreaterThan(20)
  })

  it('has no stale allowlist entries', () => {
    expect(Object.keys(ALLOWLIST).filter((k) => !mutating.includes(k))).toEqual([])
  })

  it('every other mutating route returns 403 without the gate', async () => {
    const open: string[] = []
    for (const key of mutating.filter((k) => !ALLOWLIST[k])) {
      const res = await call(key)
      if (res.statusCode !== 403) open.push(`${key} → ${res.statusCode} ${res.body}`)
    }
    expect(open).toEqual([])
  })

  it('conditional routes stay closed for a learner without requests', async () => {
    const open: string[] = []
    for (const key of Object.keys(ALLOWLIST).filter((k) => ALLOWLIST[k]!.conditional)) {
      const res = await call(key)
      if (res.statusCode !== 403) open.push(`${key} → ${res.statusCode} ${res.body}`)
    }
    expect(open).toEqual([])
  })
})
