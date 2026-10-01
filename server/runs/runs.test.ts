import { afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { Artifact } from '../../shared/contracts'
import { createAi } from '../ai'
import type { MockChatHandler } from '../ai/mock'
import { silentLog } from '../ai/test-server'
import { runAnswers, skillEvidence } from '../db/schema'
import { asAdult, createTestApp, seedLearner } from '../test/helpers'
import { HARSH } from './check'

const fail = vi.hoisted(() => ({ evidence: false }))
vi.mock('../adaptive/evidence', async (orig) => {
  const m = await orig<typeof import('../adaptive/evidence')>()
  return {
    recordEvidence: (...a: Parameters<typeof m.recordEvidence>) => {
      if (fail.evidence) throw new Error('boom')
      return m.recordEvidence(...a)
    },
  }
})

const adaptive = vi.hoisted(() => ({ calls: 0 }))
vi.mock('../adaptive/paths', async (orig) => {
  const m = await orig<typeof import('../adaptive/paths')>()
  return { ...m, onEvidence: (...a: Parameters<typeof m.onEvidence>) => (adaptive.calls++, m.onEvidence(...a)) }
})

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  fail.evidence = false
  await close?.()
  close = undefined
})

const src = [{ kind: 'model', capability: 'text' }]
const ITEMS = [
  {
    id: 'q1',
    kind: 'multipleChoice',
    prompt: 'Vilken bokstav?',
    choices: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ],
    answer: 'b',
    hints: ['Ledtråd ett', 'Ledtråd två'],
    explanation: 'Förklaring ett',
    difficulty: 2,
    skills: ['sv.letters'],
    sources: src,
  },
  {
    id: 'q2',
    kind: 'numeric',
    prompt: 'Hur mycket väger den?',
    answer: 2.5,
    unit: 'kg',
    explanation: 'Förklaring två',
    difficulty: 3,
    skills: ['ma.decimals', 'ma.units'],
    sources: src,
  },
  {
    id: 'q3',
    kind: 'freeText',
    prompt: 'Varför är himlen blå?',
    rubric: ['Ljus sprids', 'Blått sprids mest'],
    sampleAnswer: 'Exempelsvaret',
    difficulty: 4,
    skills: ['no.light'],
    sources: src,
  },
  { id: 'q4', kind: 'flashcard', prompt: 'hund', back: 'dog', difficulty: 1, skills: ['en.words'], sources: src },
]

const tf = (id: string) => ({
  id,
  kind: 'trueFalse',
  prompt: 'Sant?',
  answer: true,
  difficulty: 1,
  skills: ['x'],
  sources: src,
})

function artifact(learnerId: string, over: Partial<Record<string, unknown>> = {}, items: unknown[] = ITEMS) {
  return Artifact.parse({
    id: crypto.randomUUID(),
    learnerId,
    type: 'exercises',
    title: 'Övning',
    school: { stage: 'grundskola', year: 1 },
    sourceMode: 'extended',
    sections: [{ kind: 'practice', items }],
    feedback: 'immediate',
    approval: 'approved',
    validation: { ok: true, issues: [], checks: [], checkedAt: '2026-01-01T00:00:00Z' },
    version: 1,
    createdBy: 'adult',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  })
}

/** `ai`: mock text handler, `null` = AI not configured. */
async function setup(
  opts: { ai?: MockChatHandler | null; school?: { stage: 'grundskola' | 'gymnasieskola'; year: number } } = {},
) {
  const t = await createTestApp()
  close = t.close
  const learner = await seedLearner(t.db, (opts.school ?? { stage: 'grundskola', year: 1 }) as never)
  const store = new Map<string, Artifact>()
  t.app.ctx.loadArtifactVersion = async (_db, id, v) => {
    const a = store.get(id)
    return a && (v === undefined || v === a.version) ? a : undefined
  }
  if (opts.ai !== null)
    t.app.ctx.ai = createAi(
      { AI_TEXT_PROVIDER: 'mock', LIMIT_AI_REQUESTS_PER_HOUR: '1000' },
      { db: t.db, log: silentLog, mock: { text: opts.ai } },
    )
  const add = (a: Artifact) => (store.set(a.id, a), a)
  const bodies: string[] = []
  const call = async (method: 'GET' | 'POST', path: string, payload?: unknown, headers?: Record<string, string>) => {
    const r = await t.app.inject({
      method,
      url: `/api/v1/learners/${learner.id}${path}`,
      payload: payload as never,
      headers,
    })
    bodies.push(r.body)
    return r
  }
  const start = async (a: Artifact) => (await call('POST', '/runs', { artifactId: a.id })).json()
  const answer = async (runId: string, itemId: string, ans: unknown, attempt?: number) =>
    (await call('POST', `/runs/${runId}/answers`, { itemId, answer: ans, attempt })).json()
  const evidence = () => t.db.select().from(skillEvidence)
  return { ...t, learner, add, call, start, answer, evidence, bodies }
}

describe('immediate feedback', () => {
  it('runs the adaptive update only after answers that wrote evidence', async () => {
    const t = await setup()
    const run = await t.start(t.add(artifact(t.learner.id)))
    adaptive.calls = 0
    await t.answer(run.id, 'q1', 'a') // wrong, retry allowed: no evidence yet
    expect(await t.evidence()).toHaveLength(0)
    expect(adaptive.calls).toBe(0)
    await t.answer(run.id, 'q1', 'b') // settled: evidence
    expect((await t.evidence()).length).toBeGreaterThan(0)
    expect(adaptive.calls).toBe(1)
  })

  it('counts only hints the child asked for as hints used', async () => {
    const t = await setup()
    const run = await t.start(t.add(artifact(t.learner.id)))
    await t.call('POST', `/runs/${run.id}/hint`, { itemId: 'q1' }) // asked
    await t.answer(run.id, 'q1', 'a') // wrong: the next hint comes with the retry message
    await t.answer(run.id, 'q1', 'b')
    expect(await t.evidence()).toMatchObject([{ itemId: 'q1', misses: 1, hintsUsed: 1 }])
  })

  it('retries calmly with progressive hints, reveals after 3 tries (early band), records evidence once', async () => {
    const t = await setup()
    const a = t.add(artifact(t.learner.id))
    const run = await t.start(a)
    expect(run.state).toBe('active')
    expect(JSON.stringify(run.items)).not.toMatch(/Förklaring|Ledtråd|Exempelsvaret|"answer"|rubric/)

    const r1 = await t.answer(run.id, 'q1', 'a')
    expect(r1).toMatchObject({ correct: false, score: 0, message: 'Prova igen.', hint: 'Ledtråd ett', done: false })
    expect(r1.explanation).toBeUndefined()
    expect(r1.solution).toBeUndefined()
    const r2 = await t.answer(run.id, 'q1', 'c')
    expect(r2.hint).toBe('Ledtråd två')
    expect(await t.evidence()).toHaveLength(0)
    const r3 = await t.answer(run.id, 'q1', 'a')
    expect(r3).toMatchObject({ revealed: true, done: true, solution: 'B', explanation: 'Förklaring ett' })
    expect(r3.message).toMatch(/svaret/)
    expect((await t.call('POST', `/runs/${run.id}/answers`, { itemId: 'q1', answer: 'b' })).json().error.code).toBe(
      'item_done',
    )
    expect(await t.evidence()).toMatchObject([
      // The two hints came with "Prova igen", not on request: not counted as using hints.
      { skill: 'sv.letters', correct: false, misses: 3, hintsUsed: 0, difficulty: 2, itemId: 'q1', artifactId: a.id },
    ])

    const ok = await t.answer(run.id, 'q2', '2,5 kg')
    expect(ok).toMatchObject({ correct: true, score: 1, done: true, solution: '2,5 kg', explanation: 'Förklaring två' })
    const ev = (await t.evidence()).filter((e) => e.itemId === 'q2')
    expect(ev.map((e) => e.skill).sort()).toEqual(['ma.decimals', 'ma.units'])
    expect(ev[0]).toMatchObject({ correct: true, misses: 0, hintsUsed: 0, difficulty: 3 })

    const view = (await t.call('GET', `/runs/${run.id}`)).json()
    expect(view.progress.q1).toMatchObject({ attempts: 3, hintsShown: 2, done: true })
    expect(view.progress.q2.feedback.explanation).toBe('Förklaring två')

    // Starting again resumes the active run.
    const again = await t.call('POST', '/runs', { artifactId: a.id })
    expect(again.statusCode).toBe(200)
    expect(again.json().id).toBe(run.id)

    const summary = (await t.call('POST', `/runs/${run.id}/finish`)).json()
    expect(summary).toMatchObject({ answered: 2, total: 4, correct: 1, message: 'Du klarade 1 av 4. Bra kämpat!' })
    expect(summary.review.map((r: { itemId: string }) => r.itemId)).toEqual(['q1', 'q3', 'q4'])
    expect(summary.skills).toContainEqual({
      skill: 'ma.units',
      label: 'enheter',
      correct: 1,
      total: 1,
      note: 'Det här sitter bra.',
    })
    expect(summary.skills).toContainEqual({
      skill: 'sv.letters',
      label: 'bokstäver',
      correct: 0,
      total: 1,
      note: 'Värt att öva lite mer på.',
    })
    expect(await t.evidence()).toHaveLength(3) // nothing for unanswered items
    expect((await t.call('POST', `/runs/${run.id}/finish`)).json()).toEqual(summary) // idempotent
    for (const b of t.bodies) expect(b).not.toMatch(HARSH)
  })

  it('reveal threshold depends on the age band; partial answers get "Nästan"', async () => {
    const t = await setup({ school: { stage: 'gymnasieskola', year: 1 } })
    const ms = {
      id: 'm',
      kind: 'multiSelect',
      prompt: 'Välj',
      choices: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      answers: ['a', 'b'],
      difficulty: 2,
      skills: ['s'],
      sources: src,
    }
    const a = t.add(artifact(t.learner.id, {}, [ms, tf('t')]))
    const run = await t.start(a)
    for (let i = 0; i < 3; i++)
      expect(await t.answer(run.id, 'm', ['a'])).toMatchObject({
        message: 'Nästan! Prova igen.',
        score: 0.5,
        done: false,
      })
    expect(await t.answer(run.id, 'm', ['a'])).toMatchObject({ revealed: true, done: true }) // upper band: 4 tries
  })

  it('abandoning keeps answers, adds no penalty, and a new start begins a fresh run', async () => {
    const t = await setup()
    const a = t.add(artifact(t.learner.id))
    const run = await t.start(a)
    await t.answer(run.id, 'q1', 'a')
    expect((await t.call('POST', `/runs/${run.id}/abandon`)).json()).toEqual({ state: 'abandoned' })
    expect((await t.call('POST', `/runs/${run.id}/answers`, { itemId: 'q2', answer: '1' })).statusCode).toBe(409)
    expect(await t.evidence()).toHaveLength(0)
    expect((await t.call('GET', `/runs/${run.id}`)).json().progress.q1.attempts).toBe(1)
    const next = await t.call('POST', '/runs', { artifactId: a.id })
    expect(next.statusCode).toBe(201)
    expect(next.json().id).not.toBe(run.id)
  })
})

describe('end feedback', () => {
  it('hides correctness and answers while active, settles at finish', async () => {
    const t = await setup()
    const a = t.add(artifact(t.learner.id, { feedback: 'end', type: 'practiceTest' }))
    const run = await t.start(a)
    expect(run).toMatchObject({ mode: 'test', feedback: 'end' })
    const s1 = await t.answer(run.id, 'q1', 'b')
    expect(s1).toEqual({
      itemId: 'q1',
      attempt: 1,
      correct: null,
      score: null,
      message: 'Svaret är sparat.',
      done: false,
      revealed: false,
    })
    await t.answer(run.id, 'q2', '3') // changed below
    const s2 = await t.answer(run.id, 'q2', '5/2 kg')
    expect(s2.correct).toBeNull()
    expect(s2.hint).toBeUndefined()

    const view = (await t.call('GET', `/runs/${run.id}`)).json()
    const text = JSON.stringify(view)
    expect(text).not.toMatch(/Förklaring|Ledtråd|Exempelsvaret|"correct"/)
    expect(view.progress.q2).toMatchObject({ attempts: 2, answer: '5/2 kg', done: false })
    expect(view.progress.q2.feedback).toBeUndefined()
    expect(await t.evidence()).toHaveLength(0)

    const summary = (await t.call('POST', `/runs/${run.id}/finish`)).json()
    expect(summary).toMatchObject({ answered: 2, correct: 2, total: 4 })
    const ev = await t.evidence()
    expect(ev).toHaveLength(3)
    expect(ev.every((e) => e.correct && e.misses === 0)).toBe(true)
    const after = (await t.call('GET', `/runs/${run.id}`)).json()
    expect(after.state).toBe('finished')
    expect(after.items[0].answer).toBe('b')
    expect(after.progress.q2.feedback).toMatchObject({ correct: true, explanation: 'Förklaring två', done: true })
    for (const b of t.bodies) expect(b).not.toMatch(HARSH)
  })
})

describe('hints', () => {
  it('are progressive and run out calmly', async () => {
    const t = await setup()
    const run = await t.start(t.add(artifact(t.learner.id)))
    const hint = async () => (await t.call('POST', `/runs/${run.id}/hint`, { itemId: 'q1' })).json()
    expect(await hint()).toEqual({ hint: 'Ledtråd ett', hintsShown: 1, more: true })
    expect(await hint()).toEqual({ hint: 'Ledtråd två', hintsShown: 2, more: false })
    expect(await hint()).toEqual({ hint: null, hintsShown: 2, more: false })
    const r = await t.answer(run.id, 'q1', 'a')
    expect(r.hint).toBeUndefined()
    expect(r.message).toBe('Prova igen.')
    await t.answer(run.id, 'q1', 'b')
    expect((await t.evidence())[0]).toMatchObject({ correct: true, misses: 1, hintsUsed: 2 })
  })
})

describe('free text', () => {
  it('uses the advisory AI assessment and stores it marked as such', async () => {
    const t = await setup({
      ai: (req) =>
        req.json ? { keyPointsMet: [1, 0, 7, 1], feedback: 'Snyggt! Du fick med båda delarna.', score: 0.9 } : 'x',
    })
    const run = await t.start(t.add(artifact(t.learner.id)))
    const r = await t.answer(run.id, 'q3', { text: 'Ljuset sprids och blått mest.' })
    expect(r).toMatchObject({
      correct: true,
      score: 0.9,
      done: true,
      message: 'Snyggt! Du fick med båda delarna.',
      ai: { keyPointsMet: [0, 1], score: 0.9 },
      solution: 'Exempelsvaret',
    })
    expect((await t.evidence())[0]).toMatchObject({ skill: 'no.light', correct: true })
    const hist = (await t.call('GET', '/runs', undefined, asAdult)).json()
    expect(hist[0].answers[0]).toMatchObject({ itemId: 'q3', aiAssessed: true, assessedBy: 'ai' })
  })

  it('never passes harsh model wording on', async () => {
    const t = await setup({ ai: () => ({ keyPointsMet: [0], feedback: 'Det är fel.', score: 0.5 }) })
    const run = await t.start(t.add(artifact(t.learner.id)))
    const r = await t.answer(run.id, 'q3', { text: 'Ljus sprids.' })
    expect(r.correct).toBe(false)
    expect(JSON.stringify(r)).not.toMatch(HARSH)
  })

  for (const [name, ai] of [
    ['not configured', null],
    [
      'failing',
      () => {
        throw new Error('down')
      },
    ],
    ['returning garbage', () => ({ nope: 1 })],
  ] as const)
    it(`falls back to self-assessment when AI is ${name}`, async () => {
      const t = await setup({ ai })
      const run = await t.start(t.add(artifact(t.learner.id)))
      const r = await t.answer(run.id, 'q3', { text: 'Mitt svar' }, 1)
      expect(r).toMatchObject({
        correct: null,
        done: false,
        selfAssess: { rubric: ['Ljus sprids', 'Blått sprids mest'], sampleAnswer: 'Exempelsvaret' },
      })
      expect(await t.evidence()).toHaveLength(0)
      const rated = await t.answer(run.id, 'q3', { text: 'Mitt svar', selfRating: 'partly' }, 1)
      expect(rated).toMatchObject({ attempt: 1, correct: false, score: 0.5, done: true })
      expect(await t.answer(run.id, 'q3', { text: 'Mitt svar', selfRating: 'partly' }, 1)).toEqual(rated)
      expect(await t.evidence()).toMatchObject([{ skill: 'no.light', correct: false, misses: 1 }])
      const rows = await t.db.select().from(runAnswers)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ aiAssessed: false, final: true })
    })

  it('end mode: pending self-assessments are listed at finish and can be rated afterwards', async () => {
    const t = await setup({ ai: null })
    const a = t.add(artifact(t.learner.id, { feedback: 'end' }))
    const run = await t.start(a)
    expect((await t.answer(run.id, 'q3', { text: 'Svar' })).selfAssess).toBeUndefined()
    await t.answer(run.id, 'q4', 'knew')
    const summary = (await t.call('POST', `/runs/${run.id}/finish`)).json()
    expect(summary.selfAssess).toEqual([
      { itemId: 'q3', answer: 'Svar', rubric: ['Ljus sprids', 'Blått sprids mest'], sampleAnswer: 'Exempelsvaret' },
    ])
    expect(summary.correct).toBe(1)
    expect((await t.evidence()).map((e) => e.itemId)).toEqual(['q4'])
    const r = await t.answer(run.id, 'q3', { text: 'Svar', selfRating: 'knew' })
    expect(r).toMatchObject({ correct: true, done: true })
    const after = (await t.call('GET', `/runs/${run.id}`)).json()
    expect(after.summary).toMatchObject({ correct: 2, selfAssess: [] })
    expect((await t.evidence()).map((e) => e.itemId).sort()).toEqual(['q3', 'q4'])
    // Other items stay closed after finish.
    expect((await t.call('POST', `/runs/${run.id}/answers`, { itemId: 'q1', answer: 'b' })).statusCode).toBe(409)
  })
})

describe('integrity', () => {
  it('double submits of one attempt are idempotent', async () => {
    const t = await setup()
    const run = await t.start(t.add(artifact(t.learner.id)))
    const [x, y] = await Promise.all([t.answer(run.id, 'q2', '2,5 kg', 1), t.answer(run.id, 'q2', '2,5 kg', 1)])
    expect(x).toEqual(y)
    expect(await t.answer(run.id, 'q2', '2,5 kg', 1)).toEqual(x)
    expect(await t.db.select().from(runAnswers)).toHaveLength(1)
    expect(await t.evidence()).toHaveLength(2) // two skills, once
    expect(
      (await t.call('POST', `/runs/${run.id}/answers`, { itemId: 'q1', answer: 'a', attempt: 5 })).statusCode,
    ).toBe(409)
  })

  it('evidence and the answer commit together', async () => {
    const t = await setup()
    const run = await t.start(t.add(artifact(t.learner.id)))
    fail.evidence = true
    expect((await t.call('POST', `/runs/${run.id}/answers`, { itemId: 'q2', answer: '2,5' })).statusCode).toBe(500)
    expect(await t.db.select().from(runAnswers)).toHaveLength(0)
    fail.evidence = false
    expect(await t.answer(run.id, 'q2', '2,5')).toMatchObject({ attempt: 1, correct: true })
    expect(await t.evidence()).toHaveLength(2)
  })

  it('validates answers against the item kind', async () => {
    const t = await setup()
    const run = await t.start(t.add(artifact(t.learner.id)))
    expect((await t.call('POST', `/runs/${run.id}/answers`, { itemId: 'q1', answer: 3 })).statusCode).toBe(400)
    expect((await t.call('POST', `/runs/${run.id}/answers`, { itemId: 'nope', answer: 'a' })).statusCode).toBe(404)
  })
})

describe('permissions', () => {
  it('learner mode runs approved artifacts only; adults can preview', async () => {
    const t = await setup()
    const draft = t.add(artifact(t.learner.id, { approval: 'pendingApproval' }))
    const denied = await t.call('POST', '/runs', { artifactId: draft.id })
    expect(denied.statusCode).toBe(403)
    expect(denied.json().error.code).toBe('not_approved')
    expect((await t.call('POST', '/runs', { artifactId: draft.id }, asAdult)).statusCode).toBe(201)
    const other = t.add(artifact(crypto.randomUUID()))
    expect((await t.call('POST', '/runs', { artifactId: other.id })).statusCode).toBe(404)
    expect((await t.call('POST', '/runs', { artifactId: crypto.randomUUID() })).statusCode).toBe(404)
  })

  it('history is adult-only and filters by artifact', async () => {
    const t = await setup()
    const a = t.add(artifact(t.learner.id))
    const b = t.add(artifact(t.learner.id))
    const run = await t.start(a)
    await t.start(b)
    await t.answer(run.id, 'q1', 'b')
    expect((await t.call('GET', '/runs')).statusCode).toBe(403)
    const all = (await t.call('GET', '/runs', undefined, asAdult)).json()
    expect(all).toHaveLength(2)
    const only = (await t.call('GET', `/runs?artifactId=${a.id}`, undefined, asAdult)).json()
    expect(only).toHaveLength(1)
    expect(only[0].answers[0]).toMatchObject({ itemId: 'q1', answer: 'b', correct: true, assessedBy: 'auto' })
  })

  it('reports a missing artifact loader calmly', async () => {
    const t = await setup()
    t.app.ctx.loadArtifactVersion = undefined
    const r = await t.call('POST', '/runs', { artifactId: crypto.randomUUID() })
    expect(r.statusCode).toBe(503)
    expect(r.json().error.code).toBe('not_configured')
  })

  it('runs belong to their learner', async () => {
    const t = await setup()
    const run = await t.start(t.add(artifact(t.learner.id)))
    const other = await seedLearner(t.db)
    const r = await t.app.inject({ method: 'GET', url: `/api/v1/learners/${other.id}/runs/${run.id}` })
    expect(r.statusCode).toBe(404)
    expect(await t.db.select().from(skillEvidence).where(eq(skillEvidence.learnerId, other.id))).toHaveLength(0)
  })
})
