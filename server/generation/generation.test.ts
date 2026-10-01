import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Artifact as ArtifactSchema,
  ArtifactType,
  GenerationRequest,
  LearnerProfileInput,
  type ProcessedStudyMaterial,
} from '../../shared/contracts'
import { createAi } from '../ai'
import type { ChatRequest } from '../ai/types'
import { syncBundledCurriculum } from '../curriculum/service'
import type { Db } from '../db/client'
import { artifactVersions, learners } from '../db/schema'
import { claim, JobFailure, type JobHandler, type JobTools } from '../jobs'
import { asAdult, createTestApp, seedLearner } from '../test/helpers'
import { blueprint, generateArtifact } from './engine'
import { generationJobHandlers } from './jobs'
import { buildSystemPrompt, PROMPT_VERSION, type PromptInput } from './prompts'
import { clampInterpretation, resolveRequest } from './request'
import { loadArtifact } from './store'
import { forLearner, requestedIllustrations } from './view'

const silentLog = { info() {}, warn() {} }
const SET_ID = '11111111-1111-4111-8111-111111111111'

const material: ProcessedStudyMaterial = {
  studySetId: SET_ID,
  language: 'sv',
  topic: 'Vulkaner',
  summary: 'Om hur vulkaner bildas.',
  concepts: ['magma', 'lava'],
  curriculumRefs: [],
  segments: [
    { id: 's1', page: 1, kind: 'text', text: 'Magma är smält berg under jordytan.', confidence: 'high' },
    { id: 's2', page: 2, kind: 'definition', text: 'Lava är magma som kommit upp till ytan.', confidence: 'high' },
  ],
  processedAt: new Date().toISOString(),
}

/** A valid model-side item of the given kind. */
function fakeItem(kind: string, n: number, extra: Record<string, unknown> = {}) {
  const common = { prompt: `Fråga ${n}`, difficulty: 3, skills: ['science.volcanoes'], hints: ['Tänk efter'], ...extra }
  const byKind: Record<string, object> = {
    multipleChoice: { choices: ['a', 'b', 'c', 'd', 'e'], correctIndex: 4 },
    multiSelect: { choices: ['a', 'b', 'c'], correctIndexes: [0, 2] },
    trueFalse: { answer: true },
    fillBlank: { text: 'Lava är ___.', blanks: [['het']] },
    matching: {
      pairs: [
        { left: 'magma', right: 'under' },
        { left: 'lava', right: 'ovan' },
      ],
    },
    ordering: { correctOrder: ['ett', 'två', 'tre'] },
    numeric: { answer: 56, check: '7*8' },
    freeText: { rubric: ['nämner magma'], sampleAnswer: 'Magma.' },
    flashcard: { back: 'baksida' },
  }
  return { kind, ...common, ...byKind[kind] }
}

const kindsOf = (req: ChatRequest): string[] => {
  const it = (req.json!.jsonSchema as any).properties.items.items
  return (it.anyOf ?? it.oneOf ?? [it]).map((o: any) => o.properties.kind.const)
}

interface Script {
  interpret?: Record<string, unknown>
  item?: (kind: string, n: number, req: ChatRequest) => Record<string, unknown>
}

/** Mock text AI scripted per prompt (by schema name). Records every request. */
function scriptedAi(db: Db, s: Script = {}) {
  const calls: ChatRequest[] = []
  const vision = vi.fn(() => ({}))
  let n = 0
  const ai = createAi(
    { AI_TEXT_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock', LIMIT_AI_REQUESTS_PER_HOUR: '10000' },
    {
      db,
      log: silentLog,
      mock: {
        vision,
        text: (req) => {
          calls.push(req)
          const js = req.json!.jsonSchema as any
          switch (req.json!.name) {
            case 'request_fields':
              return s.interpret ?? {}
            case 'artifact_texts':
              return {
                title: 'Vulkaner',
                bodies: Array.from({ length: js.properties.bodies.minItems }, (_, i) => `Text ${i + 1}`),
              }
            default: {
              const kinds = kindsOf(req)
              return {
                title: 'Övning',
                items: Array.from({ length: js.properties.items.minItems }, () => {
                  const kind = kinds[n % kinds.length]!
                  n++
                  return s.item ? s.item(kind, n, req) : fakeItem(kind, n)
                }),
              }
            }
          }
        },
      },
    },
  )
  return { ai, calls, vision }
}

/** Claim and run the next job of `type` with the given handlers. */
async function runNext(db: Db, handlers: JobHandler[], type: 'artifact.generate' | 'artifact.regenerateItem') {
  const job = (await claim(db, 'test', [type]))!
  expect(job).toBeDefined()
  const tools: JobTools = {
    db,
    log: silentLog as never,
    signal: new AbortController().signal,
    progress: async () => {},
    fail: (code, msg, retryable) => {
      throw new JobFailure(code, msg, retryable)
    },
  }
  try {
    return { resultId: (await handlers.find((h) => h.type === type)!.run(job, tools)) as string, error: undefined }
  } catch (e) {
    if (e instanceof JobFailure) return { resultId: undefined, error: e.jobError }
    throw e
  }
}

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

async function setup(profile: Partial<LearnerProfileInput> = {}) {
  const t = await createTestApp()
  close = t.close
  const l = await seedLearner(t.db)
  if (Object.keys(profile).length)
    await t.db
      .update(learners)
      .set({ profile: LearnerProfileInput.parse({ ...l.profile, ...profile }) })
      .where(eq(learners.id, l.id))
  return { ...t, learnerId: l.id }
}

const post = (t: { app: any }, url: string, body: unknown, adult = true) =>
  t.app.inject({ method: 'POST', url: `/api/v1${url}`, payload: body as object, headers: adult ? asAdult : {} })

describe('request interpretation', () => {
  it('clamps to enums and limits and drops unknown subjects', () => {
    const out = clampInterpretation(
      {
        type: 'exam',
        questionCount: 500,
        difficulty: 0,
        durationMinutes: 1,
        textAmount: 'tiny',
        visualSupport: 'high',
        maxChoices: 12,
        itemKinds: ['multipleChoice', 'essay'],
        subjectCode: 'NOPE',
        stage: 'grundskola',
        year: 4,
        theme: 'tåg',
      },
      ['GRGRMAT01'],
    )
    expect(out).toEqual({
      questionCount: 60,
      difficulty: 1,
      durationMinutes: 3,
      itemKinds: ['multipleChoice'],
      school: { stage: 'grundskola', year: 4 },
      theme: 'tåg',
      support: { visualSupport: 'high', maxChoices: 6 },
    })
  })

  it('explicit form fields win over interpreted text; profile fills the rest', () => {
    const profile = LearnerProfileInput.parse({ displayName: 'Jack', school: { stage: 'grundskola', year: 2 } })
    const req = GenerationRequest.parse({ learnerId: crypto.randomUUID(), type: 'exercises', questionCount: 5 })
    const r = resolveRequest(
      req,
      ['type', 'questionCount'],
      { type: 'lesson', questionCount: 10, theme: 'tåg', school: { stage: 'grundskola', year: 4 }, feedback: 'end' },
      profile,
    )
    expect(r).toMatchObject({ type: 'exercises', questionCount: 5, theme: 'tåg', feedback: 'end' })
    expect(r.school).toEqual({ stage: 'grundskola', year: 4 })
    expect(r.support).toEqual(profile.support)
  })

  it('runs one cheap interpretation call before generating', async () => {
    const t = await setup()
    const { ai, calls } = scriptedAi(t.db, {
      interpret: { questionCount: 99, theme: 'tåg', topic: 'multiplikation', textAmount: 'minimal', type: 'bogus' },
    })
    const r = await post(t, `/learners/${t.learnerId}/generate`, {
      instructions: 'Skapa 10 matteuppgifter om multiplikation. Använd tåg som tema, lite text.',
      questionCount: 4,
    })
    expect(r.statusCode).toBe(202)
    const { resultId } = await runNext(t.db, generationJobHandlers({ ai }), 'artifact.generate')
    expect(calls[0]!.json!.name).toBe('request_fields')
    const a = (await loadArtifact(t.db, resultId!))!
    expect(a.artifact.type).toBe('exercises')
    expect(a.artifact.sections.flatMap((s) => s.items)).toHaveLength(4)
    expect(a.row.request).toMatchObject({ theme: 'tåg', topic: 'multiplikation', support: { textAmount: 'minimal' } })
    expect(calls[1]!.system).toContain('Tema: tåg')
  })
})

describe('prompt building', () => {
  const profile = LearnerProfileInput.parse({
    displayName: 'Jack',
    school: { stage: 'grundskola', year: 1 },
    interests: ['tåg', 'Jacks tunnelbana'],
    support: { textAmount: 'minimal', visualSupport: 'high', maxChoices: 3, stepByStep: true },
  })
  const base: PromptInput = {
    type: 'exercises',
    school: profile.school,
    band: 'early',
    profileText: 'Elev i grundskola, år 1.',
    support: profile.support,
    difficulty: 3,
    hasInterests: true,
    sourceMode: 'sourceAndCurriculum',
    curriculum: [
      { id: 'C1', subjectName: 'Matematik', text: 'Naturliga tal och deras egenskaper.' },
      { id: 'C2', subjectName: 'Matematik', area: 'Geometri', text: 'Grundläggande geometriska objekt.' },
    ],
    hints: true,
    feedback: 'immediate',
    durationMinutes: 10,
    includeImages: false,
  }

  it('includes age band and support preferences, never the name, only the offered curriculum ids', () => {
    const p = buildSystemPrompt(base)
    expect(p).toContain('åldersgrupp early')
    expect(p).toContain('Textmängd: minimal')
    expect(p).toContain('Högst 3 svarsalternativ')
    expect(p).toContain('Steg för steg')
    expect(p).toContain('Visuellt stöd: högt')
    expect(p).toContain('- C1: [Matematik] Naturliga tal')
    expect(p).toContain('- C2: [Matematik / Geometri]')
    expect(p.match(/\bC\d+\b/g)!.sort()).toEqual(['C1', 'C2'])
    expect(p).toMatch(/Inget våld, inga vapen/)
  })

  it('strict mode demands upload sources and leaves curriculum out', () => {
    const p = buildSystemPrompt({ ...base, sourceMode: 'strict', material })
    expect(p).toContain('Källläge STRIKT')
    expect(p).toContain('MÅSTE ange sourceSegmentIds')
    expect(p).toContain('[s1] (sida 1, text) Magma')
    expect(p).not.toContain('C1')
  })

  it('end-to-end prompts never contain the learner name and offer only real curriculum texts', async () => {
    const t = await setup({ interests: ['Jacks tåg'], displayName: 'Jack' })
    await syncBundledCurriculum(t.db)
    const { ai, calls } = scriptedAi(t.db, { item: (k, n) => fakeItem(k, n, { curriculumIds: ['C1', 'C99'] }) })
    await post(t, `/learners/${t.learnerId}/generate`, {
      type: 'exercises',
      subjectCode: 'GRGRMAT01',
      topic: 'multiplikation',
      instructions: 'Övningar för Jack om multiplikation',
      questionCount: 2,
    })
    const { resultId } = await runNext(t.db, generationJobHandlers({ ai }), 'artifact.generate')
    for (const c of calls) {
      expect(c.system).not.toMatch(/\bJacks?\b/)
      expect(JSON.stringify(c.messages)).not.toMatch(/\bJacks?\b/)
    }
    expect(calls[0]!.json!.name).toBe('request_fields')
    expect(calls[1]!.system).toMatch(/- C1: \[Matematik/)
    const items = (await loadArtifact(t.db, resultId!))!.artifact.sections[0]!.items
    expect(items[0]!.curriculumRefs).toHaveLength(1) // C99 was never offered
    expect(items[0]!.curriculumRefs[0]).toMatchObject({ source: 'skolverket', subjectCode: 'GRGRMAT01' })
    expect(items[0]!.sources.some((s) => s.kind === 'curriculum')).toBe(true)
  }, 120_000)
})

describe('generation engine', () => {
  const profile = LearnerProfileInput.parse({ displayName: 'Jack', school: { stage: 'grundskola', year: 5 } })
  const resolved = (type: ArtifactType, extra: Partial<GenerationRequest> = {}) =>
    resolveRequest(
      GenerationRequest.parse({ learnerId: crypto.randomUUID(), type, ...extra }),
      Object.keys(extra),
      {},
      profile,
    )

  it.each(ArtifactType.options)('%s produces a contract-valid artifact', async (type) => {
    const t = await setup()
    const { ai } = scriptedAi(t.db)
    const r = resolved(type, { questionCount: 4 })
    const g = await generateArtifact(
      { db: t.db, text: ai.text! },
      { request: r, profile },
      { id: crypto.randomUUID(), learnerId: t.learnerId, createdBy: 'adult', version: 1 },
    )
    expect(g.ok).toBe(true)
    ArtifactSchema.parse(g.artifact)
    expect(g.artifact.sections.length).toBe(blueprint(r).length)
    if (type === 'lesson')
      expect(g.artifact.sections.map((s) => s.kind)).toEqual([
        'intro',
        'explanation',
        'example',
        'practice',
        'recap',
        'check',
      ])
    if (type === 'flashcards') expect(g.artifact.sections[0]!.items.every((i) => i.kind === 'flashcard')).toBe(true)
  })

  it('honours maxChoices, hints off and item kinds', async () => {
    const t = await setup()
    const { ai, calls } = scriptedAi(t.db)
    const r = resolved('exercises', {
      questionCount: 2,
      itemKinds: ['multipleChoice'],
      hints: false,
      support: { maxChoices: 3 },
    })
    const g = await generateArtifact(
      { db: t.db, text: ai.text! },
      { request: r, profile },
      { id: crypto.randomUUID(), learnerId: t.learnerId, createdBy: 'adult', version: 1 },
    )
    expect(kindsOf(calls[0]!)).toEqual(['multipleChoice'])
    const item = g.artifact.sections[0]!.items[0]!
    if (item.kind !== 'multipleChoice') throw new Error('kind')
    expect(item.choices).toHaveLength(3)
    expect(item.choices.find((c) => c.id === item.answer)!.text).toBe('e') // answer kept when trimming
    expect(item.hints).toEqual([])
  })

  it('generates large tests in chunked sections', async () => {
    const t = await setup()
    const { ai, calls } = scriptedAi(t.db)
    const g = await generateArtifact(
      { db: t.db, text: ai.text! },
      { request: resolved('practiceTest', { questionCount: 25 }), profile },
      { id: crypto.randomUUID(), learnerId: t.learnerId, createdBy: 'adult', version: 1 },
    )
    expect(calls.map((c) => (c.json!.jsonSchema as any).properties.items.minItems)).toEqual([10, 10, 5])
    expect(g.artifact.sections.map((s) => [s.title, s.items.length])).toEqual([
      ['Del 1', 10],
      ['Del 2', 10],
      ['Del 3', 5],
    ])
    const ids = g.artifact.sections.flatMap((s) => s.items.map((i) => i.id))
    expect(new Set(ids).size).toBe(25)
    expect(calls[2]!.messages[0]!.content).toContain('Upprepa inte')
  })
})

describe('strict mode and the validation-failure path', () => {
  const loadMaterial = vi.fn(async () => material)

  it('rejects items without upload sources, regenerates them once and then passes', async () => {
    const t = await setup()
    const { ai, calls } = scriptedAi(t.db, {
      item: (k, n, req) =>
        fakeItem(k, n, req.messages[0]!.content.includes('underkändes') ? { sourceSegmentIds: ['s2'] } : {}),
    })
    await post(t, `/learners/${t.learnerId}/generate`, {
      type: 'exercises',
      sourceMode: 'strict',
      studySetId: SET_ID,
      questionCount: 2,
      itemKinds: ['trueFalse'],
    })
    const { resultId, error } = await runNext(t.db, generationJobHandlers({ ai, loadMaterial }), 'artifact.generate')
    expect(error).toBeUndefined()
    expect(calls.filter((c) => c.messages[0]!.content.includes('underkändes'))).toHaveLength(1)
    const a = (await loadArtifact(t.db, resultId!))!.artifact
    expect(a.approval).toBe('approved')
    for (const i of a.sections[0]!.items)
      expect(i.sources).toEqual([
        { kind: 'upload', studySetId: SET_ID, page: 2, segmentId: 's2', excerpt: material.segments[1]!.text },
      ])
  })

  it('stores a draft with the report and fails the job when the repair also fails', async () => {
    const t = await setup()
    const { ai, calls } = scriptedAi(t.db) // never cites segments
    await post(t, `/learners/${t.learnerId}/generate`, {
      type: 'exercises',
      sourceMode: 'strict',
      studySetId: SET_ID,
      questionCount: 3,
    })
    const { error } = await runNext(t.db, generationJobHandlers({ ai, loadMaterial }), 'artifact.generate')
    expect(error).toMatchObject({ code: 'validation_failed', retryable: false })
    expect(error!.adultMessage).toMatch(/utkast/)
    expect(calls.filter((c) => c.messages[0]!.content.includes('underkändes'))).toHaveLength(1)
    const list = await t.app.inject({ url: `/api/v1/learners/${t.learnerId}/artifacts`, headers: asAdult })
    expect(list.json()).toHaveLength(1)
    const a = (await loadArtifact(t.db, list.json()[0].id))!.artifact
    expect(a.approval).toBe('draft')
    expect(a.validation.ok).toBe(false)
    expect(a.validation.issues.map((i) => i.code)).toContain('strict_source')
    expect((await post(t, `/artifacts/${a.id}/approve`, {})).statusCode).toBe(409)
  })

  it('treats the validator report as authoritative', async () => {
    const t = await setup()
    const { ai } = scriptedAi(t.db)
    const validate = vi.fn(async () => ({
      ok: false,
      issues: [{ severity: 'error' as const, code: 'math', itemId: 'i1', message: 'Fel svar' }],
      checks: ['math'],
      checkedAt: new Date().toISOString(),
    }))
    await post(t, `/learners/${t.learnerId}/generate`, { type: 'exercises', questionCount: 2 })
    const { error } = await runNext(t.db, generationJobHandlers({ ai, validate }), 'artifact.generate')
    expect(error!.code).toBe('validation_failed')
    expect(validate).toHaveBeenCalledTimes(2)
  })

  it('strict mode needs a study set', async () => {
    const t = await setup()
    const r = await post(t, `/learners/${t.learnerId}/generate`, { type: 'exercises', sourceMode: 'strict' })
    expect(r.statusCode).toBe(400)
  })
})

describe('approval, listing and learner access', () => {
  it('immediate policy approves valid material; parent policy waits for an adult', async () => {
    const t = await setup({ generation: { approval: 'parent', learnerRequestsAllowed: true } })
    const { ai } = scriptedAi(t.db)
    const handlers = generationJobHandlers({ ai })
    await post(t, `/learners/${t.learnerId}/generate`, { type: 'flashcards', questionCount: 2 })
    const { resultId } = await runNext(t.db, handlers, 'artifact.generate')
    const url = `/api/v1/artifacts/${resultId}`
    expect((await t.app.inject({ url, headers: asAdult })).json().artifact.approval).toBe('pendingApproval')
    expect((await t.app.inject({ url })).statusCode).toBe(404)
    expect((await t.app.inject({ url: `/api/v1/learners/${t.learnerId}/artifacts` })).json()).toEqual([])

    expect((await post(t, `/artifacts/${resultId}/approve`, {}, false)).statusCode).toBe(403)
    expect((await post(t, `/artifacts/${resultId}/approve`, {})).json().approval).toBe('approved')
    expect((await t.app.inject({ url })).statusCode).toBe(200)
    expect((await t.app.inject({ url: `/api/v1/learners/${t.learnerId}/artifacts` })).json()).toHaveLength(1)
    expect((await post(t, `/artifacts/${resultId}/reject`, {})).json().approval).toBe('rejected')

    await t.db
      .update(learners)
      .set({ profile: LearnerProfileInput.parse({ displayName: 'Jack', school: { stage: 'grundskola', year: 1 } }) })
      .where(eq(learners.id, t.learnerId))
    await post(t, `/learners/${t.learnerId}/generate`, { type: 'flashcards', questionCount: 2 })
    const second = await runNext(t.db, handlers, 'artifact.generate')
    expect((await loadArtifact(t.db, second.resultId!))!.artifact.approval).toBe('approved')
    const filtered = await t.app.inject({
      url: `/api/v1/learners/${t.learnerId}/artifacts?approval=rejected`,
      headers: asAdult,
    })
    expect(filtered.json().map((a: { id: string }) => a.id)).toEqual([resultId])
  })

  it('learner requests need the profile permission', async () => {
    const t = await setup({ generation: { approval: 'immediate', learnerRequestsAllowed: false } })
    expect((await post(t, `/learners/${t.learnerId}/generate`, { type: 'exercises' }, false)).statusCode).toBe(403)
    expect((await post(t, `/learners/${t.learnerId}/generate`, { type: 'exercises' })).statusCode).toBe(202)
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/learners/${t.learnerId}`,
      payload: { generation: { learnerRequestsAllowed: true } },
      headers: asAdult,
    })
    expect((await post(t, `/learners/${t.learnerId}/generate`, { type: 'exercises' }, false)).statusCode).toBe(202)
    const jobs = await t.app.inject({
      url: `/api/v1/jobs/${(await post(t, `/learners/${t.learnerId}/generate`, { type: 'story' }, false)).json().jobId}`,
    })
    expect(jobs.statusCode).toBe(200)
    const { ai } = scriptedAi(t.db)
    const h = generationJobHandlers({ ai })
    const createdBy = []
    for (let i = 0; i < 3; i++) {
      const { resultId } = await runNext(t.db, h, 'artifact.generate')
      createdBy.push((await loadArtifact(t.db, resultId!))!.artifact.createdBy)
    }
    expect(createdBy).toEqual(['adult', 'learner', 'learner'])
  })

  it('forLearner strips answers, rubrics and explanations; feedback=end serves it to learners', async () => {
    const t = await setup()
    const { ai } = scriptedAi(t.db)
    await post(t, `/learners/${t.learnerId}/generate`, {
      type: 'practiceTest',
      questionCount: 6,
      feedback: 'end',
      itemKinds: ['multipleChoice', 'fillBlank', 'matching', 'freeText', 'ordering', 'numeric'],
    })
    const { resultId } = await runNext(t.db, generationJobHandlers({ ai }), 'artifact.generate')
    const full = (await loadArtifact(t.db, resultId!))!.artifact
    const stripped = forLearner(full)
    const json = JSON.stringify(stripped)
    for (const key of [
      '"answer"',
      '"answers"',
      '"rubric"',
      '"sampleAnswer"',
      '"explanation"',
      '"accepted"',
      '"pairs"',
      '"validation"',
    ])
      expect(json).not.toContain(key)
    const items = stripped.sections[0]!.items
    expect(items.find((i) => i.kind === 'fillBlank')!.blankCount).toBe(1)
    expect(items.find((i) => i.kind === 'matching')!.right).toEqual(['ovan', 'under'])
    const r = await t.app.inject({ url: `/api/v1/artifacts/${resultId}` })
    expect(r.json().artifact).toEqual(JSON.parse(json))
  })
})

describe('editing, regeneration and transforms', () => {
  async function generated(extra: Record<string, unknown> = {}, loadMaterial?: () => Promise<ProcessedStudyMaterial>) {
    const t = await setup()
    const s = scriptedAi(t.db, {
      item: (k, n) => fakeItem(k, n, { sourceSegmentIds: ['s1'], illustration: 'En vulkan' }),
    })
    const handlers = generationJobHandlers({ ai: s.ai, loadMaterial })
    await post(t, `/learners/${t.learnerId}/generate`, {
      type: 'exercises',
      questionCount: 3,
      itemKinds: ['multipleChoice'],
      ...extra,
    })
    const { resultId } = await runNext(t.db, handlers, 'artifact.generate')
    return { t, ...s, handlers, id: resultId! }
  }

  it('edits create validated versions and keep history', async () => {
    const { t, id } = await generated()
    const patch = (payload: object) =>
      t.app.inject({ method: 'PATCH', url: `/api/v1/artifacts/${id}`, payload, headers: asAdult })
    const r = await patch({
      title: 'Ny titel',
      items: { i1: { prompt: 'Ändrad fråga', answer: 'c2' } },
      removeItems: ['i3'],
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ version: 2, title: 'Ny titel', approval: 'approved' })
    const a = (await loadArtifact(t.db, id))!
    expect(a.artifact.sections[0]!.items.map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(a.artifact.sections[0]!.items[0]).toMatchObject({ prompt: 'Ändrad fråga', answer: 'c2' })
    expect(a.illustrations.map((i) => i.itemId)).toEqual(['i1', 'i2'])

    // Answer not among the choices: rejected, nothing stored.
    const bad = await patch({ items: { i1: { answer: 'zz' } } })
    expect(bad.statusCode).toBe(422)
    expect(bad.json().validation.issues.map((i: { code: string }) => i.code)).toContain('answer_missing')
    expect((await patch({ items: { nope: { prompt: 'x' } } })).statusCode).toBe(400)
    expect((await patch({ items: { i1: { prompt: '' } } })).statusCode).toBe(400)

    const versions = await t.app.inject({ url: `/api/v1/artifacts/${id}/versions`, headers: asAdult })
    expect(versions.json().map((v: { version: number; origin: string }) => [v.version, v.origin])).toEqual([
      [2, 'edit'],
      [1, 'generate'],
    ])
    const rows = await t.db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, id))
    expect(rows.find((v) => v.version === 1)!.content.sections[0]!.items).toHaveLength(3)
    expect(rows.find((v) => v.version === 1)!).toMatchObject({ promptVersion: PROMPT_VERSION, model: 'mock' })
  })

  it('regenerates one item as a new version, keeping its id', async () => {
    const { t, id, handlers, calls } = await generated()
    const r = await post(t, `/artifacts/${id}/items/i2/regenerate`, {})
    expect(r.statusCode).toBe(202)
    expect((await post(t, `/artifacts/${id}/items/zz/regenerate`, {})).statusCode).toBe(404)
    await runNext(t.db, handlers, 'artifact.regenerateItem')
    const a = (await loadArtifact(t.db, id))!.artifact
    expect(a.version).toBe(2)
    expect(a.sections[0]!.items.map((i) => i.id)).toEqual(['i1', 'i2', 'i3'])
    expect(a.sections[0]!.items[1]!.prompt).toBe('Fråga 4')
    expect(calls.at(-1)!.messages[0]!.content).toContain('Ersätt denna uppgift')
  })

  it('transforms reuse the stored artifact and processed material without vision', async () => {
    const loadMaterial = vi.fn(async () => material)
    const { t, id, handlers, calls, vision } = await generated(
      { studySetId: SET_ID, sourceMode: 'sourceAndCurriculum' },
      loadMaterial,
    )
    expect((await post(t, `/artifacts/${id}/transform`, { kind: 'changeTheme' })).statusCode).toBe(400)
    expect((await post(t, `/artifacts/${id}/transform`, { kind: 'harder' })).statusCode).toBe(202)
    const before = calls.length
    await runNext(t.db, handlers, 'artifact.generate')
    expect(vision).not.toHaveBeenCalled()
    expect(loadMaterial).toHaveBeenLastCalledWith(t.db, SET_ID)
    const prompt = calls[before]!
    expect(prompt.messages[0]!.content).toContain('Omarbetning: Gör uppgifterna svårare')
    expect(prompt.messages[0]!.content).toContain('Fråga 1')
    expect(prompt.system).toContain('[s1] (sida 1, text) Magma')
    const a = (await loadArtifact(t.db, id))!
    expect(a.artifact.version).toBe(2)
    expect(a.row.request).toMatchObject({ difficulty: 4 }) // later transforms build on it
    expect(prompt.system).toContain('Svårighetsgrad: 4 av 5')

    // "more" makes a new artifact that avoids repeating the old questions.
    await post(t, `/artifacts/${id}/transform`, { kind: 'more' })
    const { resultId } = await runNext(t.db, handlers, 'artifact.generate')
    expect(resultId).not.toBe(id)
    expect(calls.at(-1)!.messages[0]!.content).toContain('Upprepa inte')
  })

  it('exposes requested illustrations for the image domain', async () => {
    const { t, id } = await generated({ includeImages: true })
    const s = (await loadArtifact(t.db, id))!
    expect(requestedIllustrations(s)).toEqual([
      { itemId: 'i1', description: 'En vulkan' },
      { itemId: 'i2', description: 'En vulkan' },
      { itemId: 'i3', description: 'En vulkan' },
    ])
    const adult = await t.app.inject({ url: `/api/v1/artifacts/${id}`, headers: asAdult })
    expect(adult.json().requestedIllustrations).toHaveLength(3)
  })
})
