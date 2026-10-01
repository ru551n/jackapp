import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Artifact as ArtifactSchema,
  ArtifactType,
  GenerationRequest,
  LearnerProfileInput,
  type ProcessedStudyMaterial,
} from '../../shared/contracts'
import { AiError, createAi } from '../ai'
import { FetchError, type Fetcher } from '../research/fetch'
import type { ChatRequest } from '../ai/types'
import { syncBundledCurriculum } from '../curriculum/service'
import type { Db } from '../db/client'
import { artifactVersions, learners, studySets } from '../db/schema'
import { claim, JobFailure, type JobHandler, type JobTools } from '../jobs'
import { asAdult, createTestApp, seedLearner } from '../test/helpers'
import { toProviderSchema } from '../ai/structured'
import { isStrictCompatible, toStrictSchema } from '../ai/openai'
import { jobsServices } from '../jobs'
import { targetLanguage } from '../validation/subjects'
import { blueprint, generateArtifact, offerCurriculum } from './engine'
import { fallbackSkill, genItemsSchema, ITEM_KINDS, itemSkills, normalizeSkill, toItem } from './items'
import { generationJobHandlers, type GenerationDeps } from './jobs'
import {
  buildSystemPrompt,
  itemsTask,
  languageBlock,
  PROMPT_VERSION,
  safetyBlock,
  selectMaterial,
  type PromptInput,
} from './prompts'
import { clampInterpretation, resolveRequest } from './request'
import { loadArtifact, setApproval } from './store'
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
  interpret?: Record<string, unknown> | 'broken'
  texts?: (call: number, req: ChatRequest) => { title: string; bodies: string[] } | undefined
  item?: (kind: string, n: number, req: ChatRequest) => Record<string, unknown>
}

/** Mock text AI scripted per prompt (by schema name). Records every request. */
function scriptedAi(db: Db, s: Script = {}) {
  const calls: ChatRequest[] = []
  const vision = vi.fn(() => ({}))
  let n = 0
  let textCall = 0
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
              return s.interpret === 'broken' ? 'inte json' : (s.interpret ?? {})
            case 'research_brief':
              return {
                summary: 'Vulkaner bildas där magma tränger upp genom jordskorpan.',
                keyPoints: [{ text: 'Island har många aktiva vulkaner.', sources: [1] }],
              }
            case 'artifact_texts':
              return (
                s.texts?.(textCall++, req) ?? {
                  title: 'Vulkaner',
                  bodies: Array.from({ length: js.properties.bodies.minItems }, (_, i) => `Text ${i + 1}`),
                }
              )
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
  await t.db.insert(studySets).values({ id: SET_ID, learnerId: l.id, title: 'Vulkaner', status: 'ready' })
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

  it('items carry the requested skill tags (or finer ones), for adaptive evidence', async () => {
    const t = await setup()
    const tags = [['math.multiplication.tables-6-9', 'math.multiplication'], ['science.volcanoes'], ['math.division']]
    const { ai, calls } = scriptedAi(t.db, { item: (k, n) => fakeItem(k, n, { skills: tags[(n - 1) % 3] }) })
    await post(t, `/learners/${t.learnerId}/generate`, {
      type: 'exercises',
      questionCount: 3,
      skills: ['math.multiplication', 'math.division'],
    })
    const { resultId } = await runNext(t.db, generationJobHandlers({ ai }), 'artifact.generate')
    const items = (await loadArtifact(t.db, resultId!))!.artifact.sections.flatMap((s) => s.items)
    expect(items.map((i) => i.skills)).toEqual([
      ['math.multiplication.tables-6-9'], // finest only: roll-up would count math.multiplication twice
      ['math.multiplication', 'math.division'], // off-list tag → the requested ones
      ['math.division'],
    ])
    expect(calls[0]!.system).toContain('math.multiplication, math.division')
    expect(itemSkills(['a.b'], undefined)).toEqual(['a.b'])
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
  it('fails at once (no retries) when the study set failed processing', async () => {
    const t = await setup()
    const { ai } = scriptedAi(t.db, {})
    await t.db.update(studySets).set({ status: 'failed' }).where(eq(studySets.id, SET_ID))
    await post(t, `/learners/${t.learnerId}/generate`, { type: 'exercises', sourceMode: 'strict', studySetId: SET_ID })
    const { error } = await runNext(
      t.db,
      generationJobHandlers({ ai, loadMaterial: async () => undefined }),
      'artifact.generate',
    )
    expect(error).toMatchObject({ code: 'material_failed', retryable: false })
  })

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
    // One repair round: one call per failing item kind, each kind once.
    const repairKinds = calls.filter((c) => c.messages[0]!.content.includes('underkändes')).map(kindsOf)
    expect(repairKinds.length).toBeGreaterThan(0)
    expect(new Set(repairKinds.flat()).size).toBe(repairKinds.length)
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

describe('web research (useWebResearch)', () => {
  const ARTICLE = 'Vulkaner finns på många platser. Island ligger på en gräns mellan två plattor. '.repeat(6)
  const fetcher: Fetcher = async (url) => {
    if (!url.startsWith('https://vulkan.example/artikel')) throw new FetchError('http_status', 'HTTP 404')
    const body = `<html><head><title>Om vulkaner</title></head><body><p>${ARTICLE}</p></body></html>`
    return { url, status: 200, contentType: 'text/html', body: Buffer.from(body) }
  }
  const withResearch = (ai: ReturnType<typeof scriptedAi>['ai'], search = vi.fn()) => {
    search.mockResolvedValue([{ title: 'Vulkaner', url: 'https://vulkan.example/artikel', snippet: 'Om vulkaner.' }])
    return { ai: { ...ai, research: { search } }, search }
  }

  it('feeds a cited brief to the prompt, stores web SourceRefs and the brief id; transforms reuse it', async () => {
    const t = await setup()
    const { ai: base, calls } = scriptedAi(t.db, { item: (k, n) => fakeItem(k, n, { webSourceIds: ['W1', 'W7'] }) })
    const { ai, search } = withResearch(base)
    const handlers = generationJobHandlers({ ai, research: { fetcher, env: {} } })
    await post(t, `/learners/${t.learnerId}/generate`, {
      type: 'exercises',
      topic: 'Vulkaner',
      sourceMode: 'extended',
      useWebResearch: true,
      questionCount: 2,
      itemKinds: ['trueFalse'],
    })
    const { resultId, error } = await runNext(t.db, handlers, 'artifact.generate')
    expect(error).toBeUndefined()
    const itemCall = calls.find((c) => c.json!.name === 'artifact_items')!
    expect(itemCall.system).toContain('Webbresearch')
    expect(itemCall.system).toContain('Island har många aktiva vulkaner. (W1)')
    expect(itemCall.system).toContain('- W1: Om vulkaner')

    const stored = (await loadArtifact(t.db, resultId!))!
    const item = stored.artifact.sections[0]!.items[0]!
    expect(item.sources).toEqual([
      {
        kind: 'web',
        url: 'https://vulkan.example/artikel',
        title: 'Om vulkaner',
        publisher: 'vulkan.example',
        retrievedAt: expect.any(String),
      },
    ]) // W7 does not exist: dropped
    const briefId = (stored.row.request as { researchBriefId?: string }).researchBriefId
    expect(briefId).toBeTruthy()

    // Adult view → provenance view.
    const view = (await t.app.inject({ url: `/api/v1/artifacts/${resultId}`, headers: asAdult })).json()
    expect(view.researchBriefIds).toEqual([briefId])
    expect(view.assetIds).toEqual([])
    const prov = await t.app.inject({ url: `/api/v1/research/provenance?briefIds=${briefId}`, headers: asAdult })
    expect(prov.json().briefs[0].sources[0]).toMatchObject({ index: 1, url: 'https://vulkan.example/artikel' })

    // A transform builds on the stored brief: no new web search.
    await post(t, `/artifacts/${resultId}/transform`, { kind: 'harder' })
    expect((await runNext(t.db, handlers, 'artifact.generate')).error).toBeUndefined()
    expect(search).toHaveBeenCalledTimes(1)
    expect(calls.at(-1)!.system).toContain('- W1: Om vulkaner')
    const v2 = (await loadArtifact(t.db, resultId!))!
    expect(v2.artifact.version).toBe(2)
    expect(v2.artifact.sections[0]!.items[0]!.sources[0]!.kind).toBe('web')
  })

  it('generates without research when it is off, fails, or the mode is strict', async () => {
    const t = await setup()
    const { ai: base, calls } = scriptedAi(t.db)
    const body = { type: 'exercises', topic: 'Vulkaner', useWebResearch: true, questionCount: 1 }
    const run = async (h: JobHandler[], extra = {}) => {
      await post(t, `/learners/${t.learnerId}/generate`, { ...body, ...extra })
      const r = await runNext(t.db, h, 'artifact.generate')
      expect(r.error).toBeUndefined()
      return (await loadArtifact(t.db, r.resultId!))!
    }
    const off = withResearch(base)
    const a = await run(
      generationJobHandlers({ ai: off.ai, research: { fetcher, env: { FEATURE_WEB_RESEARCH: 'false' } } }),
    )
    expect(off.search).not.toHaveBeenCalled()
    expect((a.row.request as { researchBriefId?: string }).researchBriefId).toBeUndefined()
    expect(calls.at(-1)!.system).not.toContain('Webbresearch')

    const broken = withResearch(base, vi.fn())
    broken.search.mockRejectedValue(new Error('search down'))
    await run(generationJobHandlers({ ai: broken.ai, research: { fetcher, env: {} } }))
    expect(broken.search).toHaveBeenCalledTimes(1)

    const strict = withResearch(base)
    const loadMaterial = vi.fn(async () => material)
    const h = generationJobHandlers({ ai: strict.ai, loadMaterial, research: { fetcher, env: {} } })
    await post(t, `/learners/${t.learnerId}/generate`, { ...body, sourceMode: 'strict', studySetId: SET_ID })
    await runNext(t.db, h, 'artifact.generate')
    expect(strict.search).not.toHaveBeenCalled()
  })
})

describe('model-facing schemas and items', () => {
  it('item schemas are OpenAI strict compatible (nullable + required, anyOf)', () => {
    for (const kinds of [['multipleChoice'], ITEM_KINDS] as const) {
      const { jsonSchema } = toProviderSchema(genItemsSchema(kinds, 3))
      const strict = toStrictSchema(jsonSchema)
      expect(isStrictCompatible(strict)).toBe(true)
      expect(JSON.stringify(strict)).not.toMatch(/"oneOf"|"minLength"|"default"/)
    }
    const parsed = genItemsSchema(['trueFalse'], 1).parse({
      items: [{ kind: 'trueFalse', prompt: 'P', difficulty: 2, skills: ['a.b'], answer: true }],
    })
    expect(parsed.title).toBeNull()
    const { item } = toItem(parsed.items[0]!, 'i1', { curriculum: new Map(), maxChoices: 4, includeHints: true })
    expect(item).not.toHaveProperty('explanation', null)
    expect(item.lang).toBe('sv')
  })

  it('multiSelect keeps a wrong option; becomes multiple choice when maxChoices is too small', () => {
    const ctx = (maxChoices: number) => ({ curriculum: new Map(), maxChoices, includeHints: true })
    const g = {
      kind: 'multiSelect' as const,
      prompt: 'Vilka är jämna?',
      difficulty: 2,
      skills: ['math.even'],
      choices: ['2', '4', '5', '7'],
      correctIndexes: [0, 1],
    }
    const three = toItem(g, 'i1', ctx(3)).item
    expect(three.kind).toBe('multiSelect')
    if (three.kind !== 'multiSelect') throw new Error('kind')
    expect(three.choices.map((c) => c.text)).toEqual(['2', '4', '5'])
    const two = toItem(g, 'i1', ctx(2)).item
    expect(two.kind).toBe('multipleChoice')
    if (two.kind !== 'multipleChoice') throw new Error('kind')
    expect(two.choices.map((c) => c.text)).toEqual(['2', '5'])
    expect(two.choices.find((c) => c.id === two.answer)!.text).toBe('2')
  })

  it('normalizes skill tags and falls back to a subject-derived tag', () => {
    expect(normalizeSkill('Math.Multiplication Tables')).toBe('math.multiplication-tables')
    expect(normalizeSkill('Svenska.Läsförståelse')).toBe('svenska.lasforstaelse')
    expect(normalizeSkill('multiplikation')).toBeUndefined()
    expect(itemSkills(['Multiplikation!'], undefined, 'mat.multiplikation')).toEqual(['mat.multiplikation'])
    expect(fallbackSkill('GRGRMAT01', 'Multiplikation 6–9')).toBe('mat.multiplikation-6-9')
    expect(fallbackSkill(undefined, undefined)).toBe('allmant.allmant')
  })
})

describe('prompt safety, languages and material selection', () => {
  it('safety rules depend on age band and subject', () => {
    expect(safetyBlock('early')).toMatch(/Inget våld, inga vapen/)
    expect(safetyBlock('middle', 'GRGRMAT01')).toMatch(/Inget våld/)
    for (const [band, code] of [
      ['middle', 'GRGRHIS01'],
      ['upper', 'MAT'],
    ] as const) {
      const b = safetyBlock(band, code)
      expect(b).toContain('Historiska konflikter, krig och död')
      expect(b).toContain('sakligt och åldersanpassat, utan detaljerat våld')
      expect(b).not.toMatch(/Inget våld/)
    }
    expect(safetyBlock('upper')).toMatch(/stridsflygplan behandlas bara som teknik/)
  })

  it('language subjects: modern languages and English are target languages, Modersmål is not', () => {
    expect(targetLanguage('GRGRMSP01')).toBe('foreign')
    expect(targetLanguage('MODY')).toBe('foreign')
    expect(targetLanguage('GRGRENG01')).toBe('en')
    expect(targetLanguage('GRGRMOD01')).toBeUndefined()
    expect(targetLanguage('MODE')).toBeUndefined()
    expect(targetLanguage('SAM')).toBeUndefined()
    expect(languageBlock('GRGRMSP01', undefined)).toMatch(/språkämne/)
    expect(languageBlock('GRGRMOD01', undefined)).not.toMatch(/språkämne/)
  })

  const big: ProcessedStudyMaterial = {
    ...material,
    segments: Array.from({ length: 60 }, (_, i) => ({
      id: `p${i + 1}`,
      page: i + 1,
      kind: 'text' as const,
      text: (i === 41 ? 'Fotosyntes gör socker av ljus. ' : 'Magma och lava i vulkaner. ').repeat(20),
      confidence: 'high' as const,
    })),
  }

  it('selects relevant segments when the material is too large, and honours a page range', () => {
    expect(selectMaterial(material, 'vulkaner')).toEqual({ material })
    const sel = selectMaterial(big, 'fotosyntes')
    expect(sel.material.segments.map((s) => s.id)).toContain('p42')
    expect(sel.truncated).toMatchObject({ segmentsTotal: 60 })
    expect(sel.truncated!.pagesUsed).toContain(42)
    const ranged = selectMaterial(big, 'Öva på sidorna 10-12')
    expect(ranged.truncated).toMatchObject({ pagesUsed: [10, 11, 12], pageRange: [10, 12] })
  })

  it('records truncation on the version and shows it in the adult view', async () => {
    const t = await setup()
    const { ai, calls } = scriptedAi(t.db, { item: (k, n) => fakeItem(k, n, { sourceSegmentIds: ['p42'] }) })
    await post(t, `/learners/${t.learnerId}/generate`, {
      type: 'exercises',
      studySetId: SET_ID,
      topic: 'fotosyntes',
      questionCount: 1,
      itemKinds: ['trueFalse'],
    })
    const { resultId } = await runNext(
      t.db,
      generationJobHandlers({ ai, loadMaterial: async () => big }),
      'artifact.generate',
    )
    expect(calls.at(-1)!.system).toContain('[p42]')
    const adult = await t.app.inject({ url: `/api/v1/artifacts/${resultId}`, headers: asAdult })
    expect(adult.json().materialTruncated).toMatchObject({ segmentsTotal: 60 })
    expect(adult.json().materialTruncated.pagesUsed).toContain(42)
  })

  it('förskoleklass gets its own curriculum chapter', async () => {
    const t = await setup({ school: { stage: 'forskoleklass', year: 0 } })
    await syncBundledCurriculum(t.db)
    const r = resolveRequest(
      GenerationRequest.parse({ learnerId: t.learnerId, type: 'exercises', subjectCode: 'GRGRMAT01', topic: 'xyzzy' }),
      ['type', 'subjectCode', 'topic'],
      {},
      LearnerProfileInput.parse({ displayName: 'A', school: { stage: 'forskoleklass', year: 0 } }),
    )
    const { offered } = await offerCurriculum(t.db, r)
    expect(offered.length).toBeGreaterThan(0)
    expect(offered[0]!.subjectName).toBe('Förskoleklass')
  }, 120_000)
})

describe('practice tests, repair and recovery', () => {
  const profile = LearnerProfileInput.parse({ displayName: 'Jack', school: { stage: 'grundskola', year: 5 } })
  const resolved = (type: ArtifactType, extra: Partial<GenerationRequest> = {}) =>
    resolveRequest(
      GenerationRequest.parse({ learnerId: crypto.randomUUID(), type, ...extra }),
      Object.keys(extra),
      {},
      profile,
    )

  it('practice tests ramp difficulty and spread item kinds', () => {
    const slots = blueprint(
      resolved('practiceTest', { questionCount: 20, difficulty: 3, itemKinds: ['multipleChoice', 'numeric'] }),
    )
    expect(slots.map((s) => s.ramp)).toEqual([
      [2, 3],
      [3, 4],
    ])
    expect(slots[0]!.quota).toEqual({ multipleChoice: 5, numeric: 5 })
    const task = itemsTask({ count: 10, kinds: ['multipleChoice', 'numeric'], ramp: [2, 3], quota: slots[0]!.quota })
    expect(task).toContain('första uppgiften difficulty 2, sista 3')
    expect(task).toMatch(/5 st flerval, 5 st numeriskt svar/)
  })

  it('early learners never get free text outside writing tasks', () => {
    const early = LearnerProfileInput.parse({ displayName: 'A', school: { stage: 'grundskola', year: 1 } })
    const r = resolveRequest(
      GenerationRequest.parse({
        learnerId: crypto.randomUUID(),
        type: 'exercises',
        itemKinds: ['freeText', 'numeric'],
      }),
      ['type', 'itemKinds'],
      {},
      early,
    )
    expect(r.itemKinds).toEqual(['numeric'])
  })

  it('rewrites texts once when a body breaks the safety rules (no instant failure)', async () => {
    const t = await setup()
    const { ai, calls } = scriptedAi(t.db, {
      texts: (n, req) => ({
        title: 'Vulkaner',
        bodies: Array.from({ length: (req.json!.jsonSchema as any).properties.bodies.minItems }, () =>
          n === 0 ? 'Vulkanen dödar alla.' : 'Vulkaner sprutar lava.',
        ),
      }),
    })
    const g = await generateArtifact(
      { db: t.db, text: ai.text! },
      { request: resolved('explanation', { questionCount: 1 }), profile },
      { id: crypto.randomUUID(), learnerId: t.learnerId, createdBy: 'adult', version: 1 },
    )
    expect(g.repaired).toBe(true)
    expect(g.ok).toBe(true)
    expect(calls.filter((c) => c.json!.name === 'artifact_texts')).toHaveLength(2)
    expect(g.artifact.sections[0]!.body).toBe('Vulkaner sprutar lava.')
  })

  it('repairs per item kind, never matching replacements across kinds', async () => {
    const t = await setup()
    let repairing = false
    const { ai, calls } = scriptedAi(t.db, {
      item: (k, n, req) => {
        repairing = req.messages[0]!.content.includes('underkändes')
        return fakeItem(k, n, repairing ? { prompt: `Ny ${k}` } : { prompt: 'Ett vapen.' })
      },
    })
    const g = await generateArtifact(
      { db: t.db, text: ai.text! },
      { request: resolved('exercises', { questionCount: 2, itemKinds: ['trueFalse', 'flashcard'] }), profile },
      { id: crypto.randomUUID(), learnerId: t.learnerId, createdBy: 'adult', version: 1 },
    )
    const repairs = calls.filter((c) => c.messages[0]!.content.includes('underkändes'))
    expect(repairs.map(kindsOf)).toEqual([['trueFalse'], ['flashcard']])
    expect(g.artifact.sections[0]!.items.map((i) => [i.kind, i.prompt])).toEqual([
      ['trueFalse', 'Ny trueFalse'],
      ['flashcard', 'Ny flashcard'],
    ])
    expect(g.ok).toBe(true)
  })

  it('a failed interpretation falls back to explicit fields and the profile', async () => {
    const t = await setup()
    const { ai } = scriptedAi(t.db, { interpret: 'broken' })
    await post(t, `/learners/${t.learnerId}/generate`, { instructions: 'Något om tåg', questionCount: 2 })
    const { resultId, error } = await runNext(t.db, generationJobHandlers({ ai }), 'artifact.generate')
    expect(error).toBeUndefined()
    expect((await loadArtifact(t.db, resultId!))!.artifact.sections.flatMap((s) => s.items)).toHaveLength(2)
  })

  it('a retried generate job reuses the artifact of the earlier attempt', async () => {
    const t = await setup()
    const { ai, calls } = scriptedAi(t.db)
    const handlers = generationJobHandlers({ ai })
    await post(t, `/learners/${t.learnerId}/generate`, { type: 'flashcards', questionCount: 2 })
    const job = (await claim(t.db, 'test', ['artifact.generate']))!
    const tools: JobTools = {
      db: t.db,
      log: silentLog as never,
      signal: new AbortController().signal,
      progress: async () => {},
      fail: (code, msg, retryable) => {
        throw new JobFailure(code, msg, retryable)
      },
    }
    const h = handlers.find((x) => x.type === 'artifact.generate')!
    const first = await h.run(job, tools)
    const before = calls.length
    expect(await h.run(job, tools)).toBe(first)
    expect(calls.length).toBe(before)
    const list = await t.app.inject({ url: `/api/v1/learners/${t.learnerId}/artifacts`, headers: asAdult })
    expect(list.json()).toHaveLength(1)
  })

  it('a no longer active job stores nothing; AI retry-after reaches the job failure', async () => {
    const t = await setup()
    const { ai } = scriptedAi(t.db)
    await post(t, `/learners/${t.learnerId}/generate`, { type: 'flashcards', questionCount: 2 })
    const job = (await claim(t.db, 'test', ['artifact.generate']))!
    const tools: JobTools = {
      db: t.db,
      log: silentLog as never,
      signal: new AbortController().signal,
      progress: async () => {},
      fail: (code, msg, retryable, retryAfterMs) => {
        throw new JobFailure(code, msg, retryable, retryAfterMs)
      },
      assertActive: async () => {
        throw new Error('cancelled')
      },
    }
    const gen = (a: GenerationDeps['ai']) =>
      generationJobHandlers({ ai: a }).find((x) => x.type === 'artifact.generate')!
    await expect(gen(ai).run(job, tools)).rejects.toThrow('cancelled')
    const list = await t.app.inject({ url: `/api/v1/learners/${t.learnerId}/artifacts`, headers: asAdult })
    expect(list.json()).toHaveLength(0)

    const limited = {
      text: {
        generate: async () => {
          throw new AiError('ai_rate_limited', { retryAfterMs: 42_000 })
        },
      } as never,
    }
    const e = await gen(limited)
      .run(job, tools)
      .catch((x: unknown) => x)
    expect(e).toBeInstanceOf(JobFailure)
    expect(e).toMatchObject({ retryAfterMs: 42_000, jobError: { code: 'ai_rate_limited', retryable: true } })
  })
})

describe('learner access and learner-made requests', () => {
  it('learners never see answers, also with immediate feedback; the view can be scoped to a learner', async () => {
    const t = await setup()
    const { ai } = scriptedAi(t.db)
    await post(t, `/learners/${t.learnerId}/generate`, {
      type: 'exercises',
      questionCount: 2,
      feedback: 'immediate',
      itemKinds: ['multipleChoice', 'numeric'],
    })
    const { resultId } = await runNext(t.db, generationJobHandlers({ ai }), 'artifact.generate')
    const url = `/api/v1/artifacts/${resultId}`
    const r = await t.app.inject({ url })
    expect(r.statusCode).toBe(200)
    expect(JSON.stringify(r.json())).not.toMatch(/"answer"|"explanation"|"check"|"validation"/)
    expect((await t.app.inject({ url: `${url}?learnerId=${t.learnerId}` })).statusCode).toBe(200)
    const other = await seedLearner(t.db)
    expect((await t.app.inject({ url: `${url}?learnerId=${other.id}` })).statusCode).toBe(404)
  })

  it("another learner's study set is 404 in the route and fails in the job", async () => {
    const t = await setup()
    const other = await seedLearner(t.db)
    const OTHER_SET = '22222222-2222-4222-8222-222222222222'
    await t.db.insert(studySets).values({ id: OTHER_SET, learnerId: other.id, title: 'Y', status: 'ready' })
    const r = await post(t, `/learners/${t.learnerId}/generate`, { type: 'exercises', studySetId: OTHER_SET })
    expect(r.statusCode).toBe(404)
    // A payload enqueued some other way is checked again by the job.
    const { ai } = scriptedAi(t.db)
    await jobsServices({ db: t.db } as never).enqueue({
      type: 'artifact.generate',
      payload: {
        request: { learnerId: t.learnerId, type: 'exercises', studySetId: OTHER_SET },
        explicit: [],
        createdBy: 'adult',
      },
      learnerId: t.learnerId,
    })
    const { error } = await runNext(
      t.db,
      generationJobHandlers({ ai, loadMaterial: async () => material }),
      'artifact.generate',
    )
    expect(error).toMatchObject({ code: 'not_found', retryable: false })
  })

  it('learner requests drop adult-only fields, cap the count, wait for approval and have a daily cap', async () => {
    const t = await setup({ generation: { approval: 'immediate', learnerRequestsAllowed: true } })
    const r = await post(
      t,
      `/learners/${t.learnerId}/generate`,
      {
        type: 'exercises',
        questionCount: 50,
        useWebResearch: true,
        includeImages: true,
        school: { stage: 'gymnasieskola', year: 3 },
        support: { maxChoices: 6 },
      },
      false,
    )
    expect(r.statusCode).toBe(202)
    const job = await t.app.inject({ url: `/api/v1/jobs/${r.json().jobId}` })
    expect(job.statusCode).toBe(200)
    const { ai } = scriptedAi(t.db)
    const { resultId } = await runNext(t.db, generationJobHandlers({ ai }), 'artifact.generate')
    const a = (await loadArtifact(t.db, resultId!))!
    expect(a.artifact.approval).toBe('pendingApproval')
    expect(a.artifact.sections.flatMap((s) => s.items)).toHaveLength(20)
    expect(a.row.request).toMatchObject({ useWebResearch: false, includeImages: false })
    expect(a.artifact.school).toEqual({ stage: 'grundskola', year: 1 })

    for (let i = 1; i < 20; i++) await post(t, `/learners/${t.learnerId}/generate`, { type: 'exercises' }, false)
    const capped = await post(t, `/learners/${t.learnerId}/generate`, { type: 'exercises' }, false)
    expect(capped.statusCode).toBe(429)
    expect(capped.json().error.message).not.toMatch(/fel/i)
    expect((await post(t, `/learners/${t.learnerId}/generate`, { type: 'exercises' })).statusCode).toBe(202)
  })
})

describe('version races', () => {
  async function made() {
    const t = await setup({ generation: { approval: 'parent', learnerRequestsAllowed: true } })
    const s = scriptedAi(t.db)
    const handlers = generationJobHandlers({ ai: s.ai })
    await post(t, `/learners/${t.learnerId}/generate`, {
      type: 'exercises',
      questionCount: 2,
      itemKinds: ['multipleChoice'],
    })
    const { resultId } = await runNext(t.db, handlers, 'artifact.generate')
    return { t, handlers, id: resultId! }
  }
  const patch = (t: { app: any }, id: string, payload: object) =>
    t.app.inject({ method: 'PATCH', url: `/api/v1/artifacts/${id}`, payload, headers: asAdult })

  it('PATCH and approve refuse a stale version (body field or If-Match)', async () => {
    const { t, id } = await made()
    expect((await patch(t, id, { title: 'A', version: 1 })).statusCode).toBe(200)
    const stale = await patch(t, id, { title: 'B', version: 1 })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('version_conflict')
    expect((await post(t, `/artifacts/${id}/approve`, { version: 1 })).statusCode).toBe(409)
    const ifMatch = await t.app.inject({
      method: 'POST',
      url: `/api/v1/artifacts/${id}/approve`,
      headers: { ...asAdult, 'if-match': '"1"' },
    })
    expect(ifMatch.statusCode).toBe(409)
    expect((await post(t, `/artifacts/${id}/approve`, { version: 2 })).json().approval).toBe('approved')
  })

  it('setApproval only applies to the version that is still current', async () => {
    const { t, id } = await made()
    expect(await setApproval(t.db, id, 'approved', 2)).toBe(false)
    expect(await setApproval(t.db, id, 'approved', 1)).toBe(true)
  })

  it('an item regeneration that lost the race fails retryable instead of overwriting', async () => {
    const { t, id } = await made()
    await post(t, `/artifacts/${id}/items/i1/regenerate`, {})
    const { ai } = scriptedAi(t.db)
    // An adult edit lands while the model is working on the replacement.
    const racing = {
      text: {
        generate: async (input: any) => {
          expect((await patch(t, id, { title: 'Under tiden' })).statusCode).toBe(200)
          return ai.text!.generate(input)
        },
      } as never,
    }
    const { error } = await runNext(t.db, generationJobHandlers({ ai: racing }), 'artifact.regenerateItem')
    expect(error).toMatchObject({ code: 'version_conflict', retryable: true })
    const a = (await loadArtifact(t.db, id))!.artifact
    expect([a.title, a.version]).toEqual(['Under tiden', 2])
  })
})
