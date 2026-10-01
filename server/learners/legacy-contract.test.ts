import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { defaultState } from '../../src/store/state'
import { actions, getState } from '../../src/store/store'
import { createTestDb, type DbHandle } from '../db/client'
import { legacyProgress, legacySkillProgress } from '../db/schema'
import { seedLearner } from '../test/helpers'
import { importLegacy, LegacyAppState } from './legacy'

// Contract: what the web store actually writes to localStorage['jackapp:v1'] imports on the server.

let handle: DbHandle
beforeAll(async () => {
  handle = await createTestDb()
})
afterAll(() => handle.close())

it('the web AppState round-trips through LegacyAppState and importLegacy', async () => {
  actions._replace(defaultState())
  actions.recordAnswer('read.letters', 'q1', 0, 0)
  actions.recordAnswer('read.letters', 'q2', 1, 1)
  actions.recordAnswer('math.count', 'q3', 2, 0)
  actions.setSkillLevel('read.words', 3, true)
  actions.completeSession({ at: Date.now(), area: 'stationen', skills: ['read.letters'], firstTry: 1, total: 2 })
  actions.setParentPin('1234')
  const raw = JSON.parse(JSON.stringify(getState()))

  const parsed = LegacyAppState.parse(raw)
  expect(Object.keys(parsed.progress).sort()).toEqual(['math.count', 'read.letters', 'read.words'])

  const learner = await seedLearner(handle.db)
  const r = await importLegacy(handle.db, learner.id, raw)
  expect(r).toMatchObject({ created: true, skills: 3, skipped: [] })

  const rows = await handle.db.select().from(legacySkillProgress).where(eq(legacySkillProgress.learnerId, learner.id))
  const bySkill = Object.fromEntries(rows.map((s) => [s.skill, s]))
  expect(bySkill['read.letters']).toMatchObject({ attempts: 2, firstTry: 1, hintsUsed: 1 })
  expect(bySkill['read.words']).toMatchObject({ level: 3, levelLocked: true })
  expect(bySkill['read.letters']!.lastPracticedAt).toBeInstanceOf(Date)

  const [stored] = await handle.db.select().from(legacyProgress).where(eq(legacyProgress.id, r.importId))
  expect(stored!.data).not.toHaveProperty('parentPin')
  expect(stored!.data).toMatchObject({ missions: { stationen: 1 }, sessionCounter: 1 })
})
