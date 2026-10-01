import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { LearnerProfileInput, LearningPath, type ItemKind } from '../../shared/contracts'
import { createAi } from '../ai'
import { silentLog } from '../ai/test-server'
import { makeItems } from '../curriculum/import'
import { syncCurriculumSnapshot } from '../curriculum/service'
import type { Db } from '../db/client'
import { jobs, learners, learningPaths, skillReviews } from '../db/schema'
import { JobFailure } from '../jobs'
import { importLegacy } from '../learners/legacy'
import { asAdult, createTestApp, seedLearner } from '../test/helpers'
import { recordEvidence } from './evidence'
import { checkPlan, onEvidence, planPath, toLearningPaths, type PlanOutput } from './paths'
import {
  convertLegacy,
  detectPatterns,
  judge,
  loadObs,
  skillStates,
  summarizeSkills,
  type Obs,
  type Outcome,
} from './skills'
import { childSteps, nextReviewStep, nextSteps, remediationRequest, REVIEW_INTERVAL_DAYS } from './steps'

const NOW = new Date('2026-10-01T12:00:00Z')
const DAY = 86_400_000
const ago = (days: number, from = NOW) => new Date(from.getTime() - days * DAY)

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})
async function setup() {
  const t = await createTestApp()
  close = t.close
  const l = await seedLearner(t.db, { stage: 'grundskola', year: 2 } as never) // helper's type pins year 1
  return { ...t, l }
}

const obs = (outcomes: Outcome[], daysAgo = 1, skill = 'math.addition'): Obs[] =>
  outcomes.map((outcome, i) => ({ skill, outcome, at: ago(daysAgo, new Date(NOW.getTime() + i * 1000)), hintsUsed: 0 }))
const F = (n: number) => Array<Outcome>(n).fill('first')
const H = (n: number) => Array<Outcome>(n).fill('helped')
const R = (n: number) => Array<Outcome>(n).fill('retry')

/** Answers for one skill: outcome → (correct, misses, hints). Times increase by a minute per answer. */
async function answer(
  db: Db,
  learnerId: string,
  skill: string,
  outcomes: Outcome[],
  at: Date,
  extra: { difficulty?: number; itemKind?: ItemKind; hintsUsed?: number; subjectCode?: string } = {},
) {
  await recordEvidence(
    db,
    outcomes.map((o, i) => ({
      learnerId,
      skill,
      subjectCode: extra.subjectCode,
      correct: o !== 'helped',
      misses: o === 'retry' ? 1 : o === 'helped' ? 2 : 0,
      hintsUsed: extra.hintsUsed ?? 0,
      difficulty: extra.difficulty ?? 2,
      itemKind: extra.itemKind,
      at: new Date(at.getTime() + i * 60_000).toISOString(),
    })),
  )
}

describe('status rules', () => {
  it('applies the documented thresholds', () => {
    expect(judge(obs(F(2)), NOW).status).toBe('new')
    expect(judge(obs(F(4)), NOW).status).toBe('practising') // secure needs 5 answers
    expect(judge(obs(F(5)), NOW).status).toBe('secure')
    expect(judge(obs([...F(4), 'retry']), NOW).status).toBe('secure') // 4 of 5 first ≥ three quarters
    expect(judge(obs([...F(3), ...R(2)]), NOW).status).toBe('practising')
    expect(judge(obs([...F(5), 'helped']), NOW).status).toBe('practising') // newest helped blocks secure
    expect(judge(obs([...F(4), ...H(2)]), NOW).status).toBe('needsSupport') // 2 of 6 helped = a third
    expect(judge(obs([...F(7), ...H(1)]), NOW).status).toBe('practising') // 1 helped is never enough
    expect(judge(obs([...H(10), ...F(10)]), NOW).status).toBe('secure') // only the newest 10 count
  })

  it('weights recent answers more', () => {
    const oldBad = [...obs(H(5), 90), ...obs(F(5), 2)]
    const oldGood = [...obs(F(5), 90), ...obs(H(5), 2)]
    expect(judge(oldBad, NOW).status).toBe('secure')
    expect(judge(oldGood, NOW).status).toBe('needsSupport')
    // The same split with all answers recent needs support: weighting is what made the difference above.
    expect(judge([...obs(H(5), 3), ...obs(F(5), 2)], NOW).status).toBe('needsSupport')
  })
})

describe('skill model on the database', () => {
  it('summarizes with roll-up to parents and qualitative notes', async () => {
    const { db, l } = await setup()
    await answer(db, l.id, 'math.addition.tens-crossing', [...F(2), ...H(4)], ago(1), { subjectCode: 'GRGRMAT01' })
    await answer(db, l.id, 'math.addition.simple', F(6), ago(1))
    const s = await summarizeSkills(db, l.id, NOW)
    const by = Object.fromEntries(s.map((x) => [x.skill, x]))
    expect(Object.keys(by)).toEqual(['math', 'math.addition', 'math.addition.simple', 'math.addition.tens-crossing'])
    expect(by['math.addition.tens-crossing']).toMatchObject({
      status: 'needsSupport',
      evidenceCount: 6,
      subjectCode: 'GRGRMAT01',
      note: 'Verkar behöva mer träning på tiotalsövergångar (6 svar, 4 med hjälp).',
    })
    expect(by['math.addition.simple']!.status).toBe('secure')
    expect(by['math.addition']).toMatchObject({ evidenceCount: 12, status: 'needsSupport' }) // newest 10 pooled
    expect(by['math']!.evidenceCount).toBe(12)
  })

  it('detects each pattern', async () => {
    const { db, l } = await setup()
    await answer(db, l.id, 'swedish.reading.word-recognition', F(6), ago(2))
    await answer(db, l.id, 'swedish.reading.comprehension', [...F(1), ...H(4)], ago(2))
    await answer(db, l.id, 'english.vocabulary', F(6), ago(3), { itemKind: 'multipleChoice' })
    await answer(db, l.id, 'english.explaining', ['helped', 'helped', 'first'], ago(3), { itemKind: 'freeText' })
    await answer(db, l.id, 'math.multiplication', F(4), ago(4), { difficulty: 2 })
    await answer(db, l.id, 'math.multiplication', [...H(3), 'retry'], ago(4), { difficulty: 4 })
    await answer(db, l.id, 'math.division', R(10), ago(1), { hintsUsed: 1 })
    const patterns = detectPatterns(skillStates(await loadObs(db, l.id), NOW))
    const codes = patterns.map((p) => `${p.code}:${p.skill ?? ''}`).sort()
    expect(codes).toEqual([
      'harderItemsFail:math',
      'hintsOverused:',
      'recallOverExplanation:english',
      'wordRecognitionOverComprehension:swedish.reading.comprehension',
    ])
    expect(patterns.find((p) => p.code === 'harderItemsFail')!.note).toContain('3 av 4 med hjälp')
  })

  it('no detector fires on balanced evidence', async () => {
    const { db, l } = await setup()
    await answer(db, l.id, 'swedish.reading.word-recognition', F(6), ago(2))
    await answer(db, l.id, 'swedish.reading.comprehension', F(6), ago(2), { itemKind: 'freeText' })
    await answer(db, l.id, 'math.multiplication', F(4), ago(4), { difficulty: 4 })
    expect(detectPatterns(skillStates(await loadObs(db, l.id), NOW))).toEqual([])
  })

  it('converts legacy progress once, idempotently, with mapped tags', async () => {
    const { db, l } = await setup()
    const legacy = (recent: string[]) => ({
      version: 1,
      progress: {
        'math.add': { level: 2, attempts: 20, firstTry: 15, hintsUsed: 3, recent, lastPracticed: ago(30).getTime() },
        'read.words': { level: 1, attempts: 2, firstTry: 1, hintsUsed: 0, recent: ['first', 'retry'] },
        'odd.skill': { level: 1, attempts: 4, recent: ['helped', 'helped', 'helped', 'first'] },
      },
    })
    await importLegacy(db, l.id, legacy(['first', 'first', 'first', 'first', 'first', 'retry']))
    expect(await convertLegacy(db, l.id)).toBe(3)
    expect(await convertLegacy(db, l.id)).toBe(0)
    let by = Object.fromEntries((await summarizeSkills(db, l.id, NOW)).map((x) => [x.skill, x]))
    expect(by['math.addition']).toMatchObject({ status: 'secure', evidenceCount: 20 })
    expect(by['swedish.reading.word-recognition']).toMatchObject({ status: 'new', evidenceCount: 2 })
    expect(by['legacy.odd-skill']!.status).toBe('needsSupport')
    expect(by['math.addition']!.lastPracticedAt?.slice(0, 10)).toBe(ago(30).toISOString().slice(0, 10))

    // A newer import replaces the converted rows (once).
    await importLegacy(db, l.id, legacy(['helped', 'helped', 'retry', 'helped', 'retry', 'helped']))
    expect(await convertLegacy(db, l.id)).toBe(3)
    expect(await convertLegacy(db, l.id)).toBe(0)
    by = Object.fromEntries((await summarizeSkills(db, l.id, NOW)).map((x) => [x.skill, x]))
    expect(by['math.addition']!.status).toBe('needsSupport')
  })
})

describe('remediation and next steps', () => {
  const profile = (support: object) => ({
    ...LearnerProfileInput.parse({ displayName: 'Jack', school: { stage: 'grundskola', year: 2 }, support }),
    id: '00000000-0000-4000-8000-000000000001',
  })
  const summary = { skill: 'swedish.reading.comprehension', status: 'needsSupport' as const, evidenceCount: 6 }

  it('builds a targeted lesson respecting presentation preferences', () => {
    const r = remediationRequest(
      summary,
      profile({ textAmount: 'minimal', visualSupport: 'high', maxChoices: 2, repetition: 'high' }),
      { difficulty: 4 },
    )
    expect(r).toMatchObject({ type: 'lesson', difficulty: 3, questionCount: 12, includeImages: true, hints: true })
    expect(r.support).toMatchObject({ textAmount: 'minimal', visualSupport: 'high', maxChoices: 2 })
    expect(r.itemKinds).not.toContain('fillBlank')
    expect(r.itemKinds).toContain('trueFalse')
    expect(r.instructions).toMatch(/Högst 2 svarsalternativ/)
    expect(r.instructions).toMatch(/Mycket lite text/)
    expect(r.instructions!.indexOf('enklare representation')).toBeLessThan(r.instructions!.indexOf('genomarbetat'))
    expect(r.instructions).toContain('swedish.reading.comprehension')

    // Academic difficulty is independent of support: an advanced learner keeps reduced text.
    const n = remediationRequest(summary, profile({}))
    expect(n).toMatchObject({ difficulty: 1, questionCount: 8, includeImages: false })
    expect(n.itemKinds).toContain('fillBlank')
  })

  it('ranks remediate → review → path → explore; learner mode is simplified', async () => {
    const { app, db, l } = await setup()
    await seedCurriculum(db)
    await answer(db, l.id, 'math.addition', H(4), ago(1), { subjectCode: 'GRGRMAT01' })
    await answer(db, l.id, 'math.counting', F(6), ago(10), { subjectCode: 'GRGRMAT01' })
    await onEvidence(db, l.id, ago(9)) // counting becomes secure → review due after 1 day
    await insertPath(db, l.id, [{ title: 'Mönster', skills: ['math.patterns'] }])

    const steps = await nextSteps(db, l.id, NOW)
    expect(steps.map((s) => `${s.kind}:${s.skill ?? s.title}`)).toEqual([
      'remediate:math.addition',
      'review:math.counting',
      'continuePath:Mönster',
      'explore:Prova Svenska',
    ])
    expect(steps[0]!.request).toMatchObject({ learnerId: l.id, type: 'lesson', subjectCode: 'GRGRMAT01' })
    expect(steps[3]!.request.subjectCode).toBe('GRGRSVE01')

    // No decimals or percentages anywhere user-facing.
    const texts = [
      ...steps.flatMap((s) => [s.title, s.reason, s.childText]),
      ...(await summarizeSkills(db, l.id, NOW)).map((s) => s.note!),
    ]
    for (const t of texts) expect(t).not.toMatch(/\d[.,]\d|%/)

    const child = await app.inject({ url: `/api/v1/learners/${l.id}/next` })
    expect(child.json()).toEqual(childSteps(await nextSteps(db, l.id)))
    expect(JSON.stringify(child.json())).not.toMatch(/request|reason|med hjälp/)
    const adult = await app.inject({ url: `/api/v1/learners/${l.id}/next`, headers: asAdult })
    expect(adult.json()[0].request.type).toBe('lesson')
  })

  it('pattern notes contain no decimals', async () => {
    const { db, l } = await setup()
    await answer(db, l.id, 'math.division', R(7), ago(1), { hintsUsed: 1, difficulty: 4 })
    await answer(db, l.id, 'math.division', F(3), ago(1), { difficulty: 1 })
    for (const p of detectPatterns(skillStates(await loadObs(db, l.id), NOW))) expect(p.note).not.toMatch(/\d[.,]\d|%/)
  })
})

describe('spaced review', () => {
  it('steps through 1, 3, 7, 14, 30 days and resets after help', () => {
    expect(REVIEW_INTERVAL_DAYS).toEqual([1, 3, 7, 14, 30])
    let step = 0
    for (const want of [1, 2, 3, 4, 4]) expect((step = nextReviewStep(step, ['first', 'first']))).toBe(want)
    expect(nextReviewStep(3, ['first', 'retry'])).toBe(3)
    expect(nextReviewStep(3, ['first', 'helped'])).toBe(0)
    expect(nextReviewStep(2, [])).toBe(2)
  })

  it('schedules from answers after evidence arrives', async () => {
    const { db, l } = await setup()
    const t0 = ago(20)
    await answer(db, l.id, 'math.counting', F(5), t0)
    await onEvidence(db, l.id, t0)
    const review = async () => (await db.select().from(skillReviews).where(eq(skillReviews.learnerId, l.id)))[0]!
    let r = await review()
    const last = new Date(t0.getTime() + 4 * 60_000)
    expect([r.step, r.dueAt.getTime()]).toEqual([0, last.getTime() + DAY])

    const t1 = new Date(last.getTime() + DAY)
    await answer(db, l.id, 'math.counting', F(2), t1)
    await onEvidence(db, l.id, t1)
    r = await review()
    expect([r.step, r.dueAt.getTime()]).toEqual([1, t1.getTime() + 60_000 + 3 * DAY])
    await onEvidence(db, l.id, t1) // idempotent: no new answers, no change
    expect((await review()).step).toBe(1)

    await answer(db, l.id, 'math.counting', ['helped'], new Date(t1.getTime() + 3 * DAY))
    await onEvidence(db, l.id, t1)
    expect((await review()).step).toBe(0)
  })
})

describe('learning paths', () => {
  const textAi = (db: Db, handler: (msg: string) => unknown) =>
    createAi(
      { AI_TEXT_PROVIDER: 'mock' },
      { db, log: silentLog, mock: { text: (req) => handler(req.messages.at(-1)!.content) } },
    ).text
  const refIdsIn = (msg: string) => [...msg.matchAll(/^(\S+) \| /gm)].map((m) => m[1]!)
  const genJobs = (db: Db) => db.select().from(jobs).where(eq(jobs.type, 'artifact.generate'))

  it('rejects invalid AI plans deterministically', () => {
    const ok = { title: 'A', skills: ['math.addition'], refIds: ['r1'], by: '2026-10-10' }
    const check = (milestones: PlanOutput['milestones']) =>
      checkPlan({ milestones }, { allowedRefIds: new Set(['r1']), today: '2026-10-01', targetDate: '2026-11-01' })
    expect(check([ok])).toEqual([])
    expect(check([{ ...ok, skills: [] }])).toEqual(['delmål 1 saknar färdigheter'])
    expect(check([{ ...ok, skills: ['Math Addition'] }])[0]).toMatch(/ogiltig färdighetstagg/)
    expect(check([{ ...ok, skills: ['math'] }])[0]).toMatch(/ogiltig färdighetstagg/) // needs a sub-skill
    expect(check([{ ...ok, refIds: ['made-up'] }])).toEqual(['delmål 1: okänd läroplansreferens'])
    expect(check([{ ...ok, by: '2026-09-01' }])[0]).toMatch(/före/)
    expect(check([{ ...ok, by: '2026-12-01' }])[0]).toMatch(/efter måldatum/)
    expect(check([ok, { ...ok, by: '2026-10-05' }])[0]).toMatch(/före föregående/)
    expect(check([{ ...ok, by: '2026-02-31' }])[0]).toMatch(/ogiltigt datum/)
    expect(check([{ ...ok, by: '2026-13-45' }])[0]).toMatch(/ogiltigt datum/)
    expect(check(Array(13).fill(ok))).toContain('högst 12 delmål')
  })

  it('plans with AI, rejects invented refs, and generates content for the active milestone only', async () => {
    const { db, l } = await setup()
    await seedCurriculum(db)
    const bad = textAi(db, () => ({ milestones: [{ title: 'X', skills: ['math.addition'], refIds: ['invented'] }] }))
    const payload = { learnerId: l.id, goal: 'Addition med tiotalsövergång', subjectCode: 'GRGRMAT01' }
    const err = await planPath(db, bad, payload, { now: NOW }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JobFailure)
    expect((err as JobFailure).jobError.code).toBe('ai_invalid_output')
    expect(await db.select().from(learningPaths)).toHaveLength(0)

    let prompt = ''
    const good = textAi(db, (msg) => {
      prompt = msg
      const [ref] = refIdsIn(msg)
      return {
        milestones: [
          { title: 'Talkamrater till 10', skills: ['math.addition.number-bonds'], refIds: [ref] },
          { title: 'Tiotalsövergång', skills: ['math.addition.tens-crossing'], refIds: [], by: '2026-10-20' },
          { title: 'Blandat', skills: ['math.addition'], refIds: [] },
        ],
      }
    })
    const id = await planPath(db, good, payload, { now: NOW })
    expect(prompt).not.toContain('Jack') // promptProfile scrubs the name
    expect(refIdsIn(prompt).length).toBeGreaterThan(0)
    const [row] = await db.select().from(learningPaths).where(eq(learningPaths.id, id))
    expect(row!.milestones.map((m) => m.status)).toEqual(['active', 'upcoming', 'upcoming'])
    expect(row!.milestones[0]!.curriculumRefs[0]!.subjectCode).toBe('GRGRMAT01')
    const gen = await genJobs(db)
    expect(gen).toHaveLength(1) // lazy: no bulk pre-generation
    const req = (gen[0]!.payload as { request: { type: string; topic: string; curriculumRefs: unknown[] } }).request
    expect(req).toMatchObject({ type: 'lesson', topic: 'Talkamrater till 10' })
    expect(req.curriculumRefs).toHaveLength(1)
    const [path] = await toLearningPaths(db, [row!])
    expect(LearningPath.parse(path).milestones).toHaveLength(3)
  })

  it('advances on secure, inserts remediation on persistent needsSupport, completes', async () => {
    const { db, l } = await setup()
    const id = await insertPath(db, l.id, [
      { title: 'A', skills: ['math.addition.simple'] },
      { title: 'B', skills: ['math.addition.tens-crossing'] },
    ])
    const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000)
    const path = async () => (await db.select().from(learningPaths).where(eq(learningPaths.id, id)))[0]!
    const statuses = async () => (await path()).milestones.map((m) => `${m.kind[0]}:${m.status}`)

    await answer(db, l.id, 'math.addition.simple', F(3), at(1))
    expect(await onEvidence(db, l.id, at(2))).toEqual([]) // not secure yet
    await answer(db, l.id, 'math.addition.simple', F(2), at(2))
    expect((await onEvidence(db, l.id, at(3)))[0]).toMatchObject({ kind: 'advanced', milestoneId: 'm1' })
    expect(await statuses()).toEqual(['g:done', 'g:active'])
    expect(await genJobs(db)).toHaveLength(1) // m1 was inserted without a job by the test

    // needsSupport but only 3 answers since activation: not persistent yet.
    await answer(db, l.id, 'math.addition.tens-crossing', H(3), at(4))
    expect(await onEvidence(db, l.id, at(5))).toEqual([])
    await answer(db, l.id, 'math.addition.tens-crossing', H(1), at(5))
    expect((await onEvidence(db, l.id, at(6)))[0]!.kind).toBe('remediation')
    expect(await statuses()).toEqual(['g:done', 'r:active', 'g:upcoming'])
    const gen = await genJobs(db)
    expect(gen).toHaveLength(2)
    expect((gen.at(-1)!.payload as { request: { topic: string } }).request.topic).toBe(
      'Extra träning: tiotalsövergångar',
    )
    expect(await onEvidence(db, l.id, at(6))).toEqual([]) // no duplicate remediation

    // Remediation done when the skill is no longer needsSupport; B resumes without a new job.
    await answer(db, l.id, 'math.addition.tens-crossing', F(8), at(7))
    expect((await onEvidence(db, l.id, at(8)))[0]!.kind).toBe('advanced')
    expect(await statuses()).toEqual(['g:done', 'r:done', 'g:active'])
    expect(await genJobs(db)).toHaveLength(2)
    await answer(db, l.id, 'math.addition.tens-crossing', F(2), at(9))
    expect((await onEvidence(db, l.id, at(10)))[0]!.kind).toBe('completed')
    expect((await path()).status).toBe('completed')
  })

  it('serves path endpoints with the adult gate where needed', async () => {
    const { app, db, l } = await setup()
    const id = await insertPath(db, l.id, [{ title: 'A', skills: ['math.addition'] }])
    const base = `/api/v1/learners/${l.id}`
    const created = await app.inject({
      method: 'POST',
      url: `${base}/paths`,
      payload: { goal: 'Klara gångertabellen' },
    })
    expect(created.statusCode).toBe(202) // learner requests allowed by default
    const job = (await db.select().from(jobs).where(eq(jobs.id, created.json().jobId)))[0]!
    expect(job).toMatchObject({ type: 'path.plan', learnerId: l.id })
    expect(
      (await app.inject({ method: 'POST', url: `${base}/paths`, headers: asAdult, payload: { goal: '' } })).statusCode,
    ).toBe(400)

    const profile = { ...l.profile, generation: { learnerRequestsAllowed: false, approval: 'immediate' as const } }
    await db.update(learners).set({ profile }).where(eq(learners.id, l.id))
    expect((await app.inject({ method: 'POST', url: `${base}/paths`, payload: { goal: 'x' } })).statusCode).toBe(403)

    expect((await app.inject({ url: `${base}/skills` })).statusCode).toBe(403)
    expect((await app.inject({ url: `${base}/skills`, headers: asAdult })).json()).toEqual({ skills: [], patterns: [] })

    const list = await app.inject({ url: `${base}/paths` })
    expect(list.json().map((p: { id: string }) => p.id)).toEqual([id])
    expect((await app.inject({ method: 'POST', url: `${base}/paths/${id}/pause` })).statusCode).toBe(403)
    const paused = await app.inject({ method: 'POST', url: `${base}/paths/${id}/pause`, headers: asAdult })
    expect(paused.json().status).toBe('paused')
    expect((await app.inject({ method: 'POST', url: `${base}/paths/${id}/pause`, headers: asAdult })).statusCode).toBe(
      409,
    )
    const resumed = await app.inject({ method: 'POST', url: `${base}/paths/${id}/resume`, headers: asAdult })
    expect(resumed.json().status).toBe('active')
    expect((await app.inject({ method: 'DELETE', url: `${base}/paths/${id}`, headers: asAdult })).statusCode).toBe(204)
    expect((await app.inject({ url: `${base}/paths/${id}` })).statusCode).toBe(404)
  })
})

async function insertPath(db: Db, learnerId: string, ms: { title: string; skills: string[] }[]) {
  const [row] = await db
    .insert(learningPaths)
    .values({
      learnerId,
      goal: 'Testmål',
      status: 'active',
      milestones: ms.map((m, i) => ({
        ...m,
        id: `m${i + 1}`,
        kind: 'goal' as const,
        status: i === 0 ? ('active' as const) : ('upcoming' as const),
        curriculumRefs: [],
        activatedAt: i === 0 ? NOW.toISOString() : undefined,
      })),
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
  return row!.id
}

async function seedCurriculum(db: Db) {
  const subject = (code: string, name: string, texts: string[]) => ({
    code,
    name,
    stage: 'grundskola' as const,
    applicableYears: [1, 2, 3],
    syllabusType: 'COURSE_SYLLABUS',
    categories: [],
    schoolTypes: ['GR'],
    purpose: 'Syfte.',
    courses: [],
    sourceUrl: `https://api.skolverket.se/syllabus/v1/subjects/${code}`,
    items: makeItems(
      code,
      texts.map((text) => ({ kind: 'central_content' as const, span: '1-3', area: 'Område', text })),
    ),
  })
  await syncCurriculumSnapshot(db, {
    source: 'skolverket',
    version: '2026-10-01',
    retrievedAt: '2026-10-01T08:00:00.000Z',
    apiVersion: 'test',
    licence: 'CC0 1.0',
    sourceUrls: ['https://api.skolverket.se/syllabus/v1/subjects'],
    subjects: [
      subject('GRGRMAT01', 'Matematik', [
        'Addition och subtraktion med tiotalsövergång.',
        'Multiplikation och division.',
      ]),
      subject('GRGRSVE01', 'Svenska', ['Läsa och förstå texter.']),
    ],
  })
}
