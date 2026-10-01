import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { LearnerProfileInput } from '../../shared/contracts'
import { legacyProgress, legacySkillProgress } from '../db/schema'
import { asAdult, createTestApp, seedLearner } from '../test/helpers'
import { promptProfile } from './profile'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

async function setup() {
  const t = await createTestApp()
  close = t.close
  return t
}

const profileBody = {
  displayName: 'Jack',
  school: { stage: 'grundskola', year: 1 },
  interests: ['tåg', ' Tåg ', '', 'flygplan'],
  difficulties: ['Jack tappar fokus vid långa texter'],
  support: { textAmount: 'reduced', maxChoices: 3 },
}

describe('learner profiles', () => {
  it('creates, reads, patches and deletes as an adult; validates input', async () => {
    const { app } = await setup()
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/learners',
      headers: asAdult,
      payload: profileBody,
    })
    expect(created.statusCode).toBe(201)
    const p = created.json()
    expect(p.interests).toEqual(['tåg', 'flygplan'])
    expect(p.support).toMatchObject({ textAmount: 'reduced', maxChoices: 3, readAloud: true })

    const invalid = [
      { ...profileBody, school: { stage: 'grundskola', year: 0 } },
      { ...profileBody, displayName: '' },
      { ...profileBody, interests: Array(31).fill('x') },
      { ...profileBody, interests: ['a'.repeat(61)] },
      { ...profileBody, support: { maxChoices: 9 } },
    ]
    for (const payload of invalid)
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/learners', headers: asAdult, payload })).statusCode,
      ).toBe(400)
    const unsafe = await app.inject({
      method: 'POST',
      url: '/api/v1/learners',
      headers: asAdult,
      payload: { ...profileBody, themes: ['Droger'] },
    })
    expect(unsafe.json().error.code).toBe('unsafe_theme')

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/learners/${p.id}`,
      headers: asAdult,
      payload: { school: { stage: 'grundskola', year: 2 }, support: { pace: 'slow' } },
    })
    expect(patched.statusCode).toBe(200)
    const q = patched.json()
    expect(q.school.year).toBe(2)
    expect(q.support).toMatchObject({ pace: 'slow', textAmount: 'reduced', maxChoices: 3 })
    expect(q.displayName).toBe('Jack')
    expect(Date.parse(q.updatedAt)).toBeGreaterThan(Date.parse(p.updatedAt))
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/learners/${p.id}`,
          headers: asAdult,
          payload: { support: { maxChoices: 1 } },
        })
      ).statusCode,
    ).toBe(400)

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/learners/${p.id}`, headers: asAdult })).statusCode).toBe(
      204,
    )
    expect((await app.inject(`/api/v1/learners/${p.id}`)).statusCode).toBe(404)
  })

  it('enforces adult-only mutations', async () => {
    const { app, db } = await setup()
    const l = await seedLearner(db)
    const url = `/api/v1/learners/${l.id}`
    const calls = [
      { method: 'POST' as const, url: '/api/v1/learners', payload: profileBody },
      { method: 'PATCH' as const, url, payload: { displayName: 'X' } },
      { method: 'DELETE' as const, url },
      { method: 'POST' as const, url: `${url}/legacy-import`, payload: { version: 1 } },
    ]
    for (const c of calls) expect((await app.inject(c)).json().error.code).toBe('adult_required')
  })

  it('lists for the picker and gives learners a reduced view', async () => {
    const { app, db } = await setup()
    const l = await seedLearner(db)
    expect((await app.inject('/api/v1/learners')).json()).toEqual([
      { id: l.id, displayName: 'Jack', school: { stage: 'grundskola', year: 1 }, ageBand: 'early' },
    ])
    const view = (await app.inject(`/api/v1/learners/${l.id}`)).json()
    expect(Object.keys(view).sort()).toEqual(
      ['ageBand', 'displayName', 'id', 'language', 'learnerRequestsAllowed', 'presentation', 'school'].sort(),
    )
    expect(view.presentation).toMatchObject({ ageBand: 'early', maxChoices: 4, school: { year: 1 } })
    const adult = (await app.inject({ url: `/api/v1/learners/${l.id}`, headers: asAdult })).json()
    expect(adult).toHaveProperty('difficulties')
    expect((await app.inject('/api/v1/learners/not-a-uuid')).statusCode).toBe(400)
  })
})

describe('promptProfile', () => {
  it('never includes the display name, strengths or difficulties', () => {
    const p = LearnerProfileInput.parse({
      displayName: 'Jack',
      school: { stage: 'grundskola', year: 4 },
      interests: ['Jacks favorit: tåg', 'JAS Gripen'],
      themes: ['jack och flygplan'],
      strengths: ['bra på huvudräkning'],
      difficulties: ['tappar fokus vid långa texter'],
      subjectLevels: [{ subjectCode: 'GRGRMAT01', description: 'Jack räknar säkert till 100', relativeLevel: 2 }],
      support: { textAmount: 'minimal', visualSupport: 'high', stepByStep: true },
    })
    const s = promptProfile(p)
    expect(s.toLowerCase()).not.toContain('jack')
    expect(s).toContain('elevens favorit: tåg')
    expect(s).not.toContain('huvudräkning')
    expect(s).not.toContain('fokus')
    expect(s).toContain('grundskola, år 4')
    expect(s).toContain('GRGRMAT01: eleven räknar säkert till 100 (2/5')
    expect(s).toContain('JAS Gripen')
    expect(s).toMatch(/mycket lite text.*mycket bildstöd.*högst 4 svarsalternativ.*steg för steg/)
  })
})

const realPayload = {
  version: 1,
  progress: {
    'math.add': {
      level: 3,
      attempts: 42,
      firstTry: 30,
      hintsUsed: 5,
      recent: ['first', 'retry', 'first', 'bogus'],
      lastPracticed: 1758000000000,
    },
    'read.letters': { level: 2, attempts: 10, firstTry: 8, hintsUsed: 1, recent: ['first'], levelLocked: true },
    'logic.pattern': { level: 'high', recent: [] },
  },
  missions: { stationen: 4, tunnelbanan: 7, sparvagnen: 0, flygplatsen: 2, engelska: 1 },
  sessionCounter: 14,
  recentQuestionIds: ['math.add:3+4'],
  sessions: [{ at: 1758000000000, area: 'tunnelbanan', skills: ['math.add'], firstTry: 4, total: 5 }],
  settings: { sound: false, speech: true, motion: 'system', freePlayEnabled: true },
  parentPin: '1234',
  freePlay: { line: { vehicle: 'metro', stations: [{ id: 's1', name: 'Slussen', x: 10, y: 20 }] } },
}

describe('legacy import', () => {
  it('stores losslessly (minus parentPin), normalizes skills and is idempotent', async () => {
    const { app, db } = await setup()
    const l = await seedLearner(db)
    const url = `/api/v1/learners/${l.id}/legacy-import`
    const first = await app.inject({ method: 'POST', url, headers: asAdult, payload: realPayload })
    expect(first.statusCode).toBe(201)
    expect(first.json()).toMatchObject({ created: true, skills: 2, skipped: ['logic.pattern'] })

    const [raw] = await db.select().from(legacyProgress).where(eq(legacyProgress.learnerId, l.id))
    const { parentPin: _p, ...expected } = realPayload
    expect(raw!.data).toEqual(expected)
    expect(JSON.stringify(raw!.data)).not.toContain('parentPin')

    const skills = await db.select().from(legacySkillProgress).where(eq(legacySkillProgress.learnerId, l.id))
    const add = skills.find((s) => s.skill === 'math.add')!
    expect(add).toMatchObject({ level: 3, attempts: 42, firstTry: 30, hintsUsed: 5, levelLocked: false })
    expect(add.recent).toEqual(['first', 'retry', 'first'])
    expect(add.lastPracticedAt?.getTime()).toBe(1758000000000)
    expect(skills.find((s) => s.skill === 'read.letters')!.levelLocked).toBe(true)

    const again = await app.inject({ method: 'POST', url, headers: asAdult, payload: realPayload })
    expect(again.statusCode).toBe(200)
    expect(again.json()).toMatchObject({ created: false, importId: first.json().importId })
    expect(await db.select().from(legacyProgress)).toHaveLength(1)

    // A newer export replaces the normalized rows; both raw copies are kept.
    const newer = { ...realPayload, progress: { 'math.add': { ...realPayload.progress['math.add'], level: 4 } } }
    expect((await app.inject({ method: 'POST', url, headers: asAdult, payload: newer })).statusCode).toBe(201)
    expect(await db.select().from(legacyProgress)).toHaveLength(2)
    const [add2] = await db.select().from(legacySkillProgress).where(eq(legacySkillProgress.skill, 'math.add'))
    expect(add2!.level).toBe(4)
  })

  it('tolerates missing fields and rejects corrupt payloads', async () => {
    const { app, db } = await setup()
    const l = await seedLearner(db)
    const post = (payload: unknown) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/learners/${l.id}/legacy-import`,
        headers: { ...asAdult, 'content-type': 'application/json' },
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      })
    expect((await post({ version: 1 })).statusCode).toBe(201)
    for (const bad of [
      '{"version":1,',
      [],
      { version: 2 },
      { progress: {} },
      { version: 1, progress: 'x' },
      { version: 1, missions: { stationen: -1 } },
      { version: 1, sessions: 'nope' },
    ])
      expect((await post(bad)).statusCode).toBe(400)
  })
})
