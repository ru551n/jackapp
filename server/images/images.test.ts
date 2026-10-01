import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Artifact, type MediaRef } from '../../shared/contracts'
import { createAi } from '../ai'
import { createTestDb, type Db } from '../db/client'
import { assets } from '../db/schema'
import { enqueue, JobFailure, type JobRow } from '../jobs'
import { asAdult, createTestApp, seedLearner } from '../test/helpers'
import {
  applyGeneratedMedia,
  buildImagePrompt,
  illustrationJobsFor,
  imageJobHandler,
  imagesToday,
  needsRealImagery,
  reserveImage,
  type ImageJobPayload,
} from './index'

const AI_ENV = { AI_IMAGE_PROVIDER: 'mock', AI_TEXT_PROVIDER: 'mock' }
const quiet = { info() {}, warn() {} }

let cleanup: (() => Promise<void>) | undefined
afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanup?.()
  cleanup = undefined
})

const base = { subject: 'matematik', description: 'en glad dinosaurie', allowText: false } as const
const early = { ageBand: 'early', theme: 'tåg' } as const

describe('buildImagePrompt', () => {
  it('styles per age band, keeps the theme and always adds no-text and safety clauses', () => {
    const e = buildImagePrompt({ ...base, purpose: 'illustration', style: early })
    const u = buildImagePrompt({ ...base, purpose: 'diagram', style: { ageBand: 'upper' } })
    expect(e).toMatch(/calm, uncluttered/)
    expect(e).toMatch(/simple rounded shapes/)
    expect(e).toMatch(/"tåg"/)
    expect(u).toMatch(/diagram-like/)
    expect(u).toMatch(/Diagram layout/)
    expect(u).not.toMatch(/Theme:/)
    for (const p of [e, u]) {
      expect(p).toMatch(/Do not include any text/)
      expect(p).toMatch(/No violence, weapons/)
      expect(p).toMatch(/Not photorealistic/)
      expect(p).toMatch(/No real or recognisable people/)
    }
    expect(buildImagePrompt({ ...base, allowText: true, purpose: 'diagram', style: early })).not.toMatch(
      /Do not include any text/,
    )
  })

  it('demands exactly N objects for counting scenes', () => {
    const p = buildImagePrompt({ ...base, description: 'tåg', purpose: 'counting', count: 7, style: early })
    expect(p).toMatch(/EXACTLY 7 .*no more and no fewer/)
  })
})

describe('needsRealImagery', () => {
  it.each(['Saab 37 Viggen', 'vikingasvärd från Birka', 'Europakarta', 'Boeing 747 på startbanan', 'en äkta runsten'])(
    'true for %s',
    (d) => expect(needsRealImagery(d)).toBe(true),
  )
  it.each(['tre tåg som räknas', 'en glad dinosaurie', 'ett rött flygplan i molnen', 'fotosyntes i ett blad'])(
    'false for %s',
    (d) => expect(needsRealImagery(d)).toBe(false),
  )
  it('uses the subject for artifacts', () => {
    expect(needsRealImagery('ett vikingasvärd', 'historia')).toBe(true)
    expect(needsRealImagery('ett vikingasvärd', 'svenska')).toBe(false)
  })
})

describe('applyGeneratedMedia', () => {
  const ref = (id: string): MediaRef => ({
    assetId: id,
    kind: 'image',
    alt: 'AI-genererad bild: x',
    generated: true,
    license: { license: 'ai-generated', provider: 'mock', retrievedAt: 'now', autoUsable: true },
  })
  const item = (id: string) => ({
    id,
    kind: 'multipleChoice' as const,
    prompt: 'Hur många?',
    choices: [
      { id: 'a', text: '3' },
      { id: 'b', text: '4' },
    ],
    answer: 'a',
    difficulty: 1,
    skills: ['math.count'],
    sources: [{ kind: 'model' as const, capability: 'text' as const }],
  })
  const artifact = Artifact.parse({
    id: crypto.randomUUID(),
    learnerId: crypto.randomUUID(),
    type: 'exercises',
    title: 'Räkna tåg',
    school: { stage: 'grundskola', year: 1 },
    sourceMode: 'extended',
    sections: [{ kind: 'practice', items: [item('q1'), item('q2')] }],
    feedback: 'immediate',
    approval: 'draft',
    validation: { ok: true, issues: [], checks: [], checkedAt: 'now' },
    version: 1,
    createdBy: 'system',
    createdAt: 'now',
  })
  const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]

  it('inserts at section, item and choice paths without mutating the input', () => {
    const next = applyGeneratedMedia(artifact, [
      { path: 'sections.0', media: ref(a) },
      { path: 'sections.0.items.1', media: ref(b) },
      { path: 'sections.0.items.0.choices.1', media: ref(c) },
      { path: 'sections.0.items.1', media: ref(b) }, // duplicate
      { path: 'sections.3.items.0', media: ref(a) }, // gone
      { path: 'nonsense', media: ref(a) },
    ])
    const s = next.sections[0]!
    expect(s.media.map((m) => m.assetId)).toEqual([a])
    expect(s.items[1]!.media.map((m) => m.assetId)).toEqual([b])
    const q1 = s.items[0]!
    expect(q1.kind === 'multipleChoice' && q1.choices[1]!.media?.assetId).toBe(c)
    expect(artifact.sections[0]!.media).toEqual([])
    expect(Artifact.parse(next)).toEqual(next)
  })

  it('respects the per-item media maximum', () => {
    const many = Array.from({ length: 6 }, () => ({ path: 'sections.0.items.0', media: ref(crypto.randomUUID()) }))
    expect(applyGeneratedMedia(artifact, many).sections[0]!.items[0]!.media).toHaveLength(4)
  })
})

// ---- Job handler ----

async function setup(env: Record<string, string> = AI_ENV) {
  const h = await createTestDb()
  cleanup = h.close
  const dataDir = await mkdtemp(join(tmpdir(), 'jackapp-img-'))
  const ai = createAi(env, { db: h.db, log: quiet })
  return { db: h.db, ai, dataDir, env }
}

const tools = (db: Db) => ({
  db,
  log: quiet as never,
  signal: new AbortController().signal,
  progress: async () => {},
  fail: (code: string, msg: string, retryable: boolean): never => {
    throw new JobFailure(code, msg, retryable)
  },
})

const payload: ImageJobPayload = { ...base, purpose: 'counting', count: 3, description: 'tre tåg', style: early }
const run = (db: Db, h: ReturnType<typeof imageJobHandler>, p: object = payload) =>
  h.run({ payload: p } as unknown as JobRow, tools(db))
const failure = (e: unknown) => (e as JobFailure).jobError

describe('image.generate handler', () => {
  it('stores a generated asset with licence and Swedish alt text', async () => {
    const { db, ai, dataDir, env } = await setup()
    const id = await run(db, imageJobHandler({ ai, dataDir, env }))
    const [row] = await db.select().from(assets)
    expect(row).toMatchObject({ id, generated: true, alt: 'AI-genererad bild: tre tåg', mimeType: 'image/png' })
    expect(row!.license).toMatchObject({ license: 'ai-generated', provider: 'mock', autoUsable: true })
    expect(await imagesToday(db)).toBe(1)
  })

  it('enforces the daily cap', async () => {
    const { db, ai, dataDir } = await setup()
    const env = { ...AI_ENV, LIMIT_IMAGES_PER_DAY: '2' }
    const h = imageJobHandler({ ai, dataDir, env })
    await run(db, h)
    await run(db, h)
    const e = await run(db, h).catch((x) => x)
    expect(failure(e)).toMatchObject({ code: 'limit_exceeded', retryable: false })
    expect(await imagesToday(db)).toBe(2)
    expect(await reserveImage(db, 3)).toBe(true)
  })

  it('fails clearly when the feature is off or the capability is missing', async () => {
    const off = await setup()
    const offEnv = { ...AI_ENV, FEATURE_IMAGE_GENERATION: 'false' }
    const e1 = await run(off.db, imageJobHandler({ ...off, env: offEnv })).catch((x) => x)
    expect(failure(e1)).toMatchObject({ code: 'feature_disabled', retryable: false })
    expect(failure(e1).adultMessage).toMatch(/Bildgenerering är avstängd/)
    await cleanup?.()

    const none = await setup({ AI_TEXT_PROVIDER: 'mock' })
    expect(none.ai.image).toBeUndefined()
    const e2 = await run(none.db, imageJobHandler(none)).catch((x) => x)
    expect(failure(e2)).toMatchObject({ code: 'capability_missing' })
    expect(failure(e2).adultMessage).toMatch(/inte konfigurerad/)
  })

  it('refuses factual reference imagery and unsafe content before calling the provider', async () => {
    const { db, ai, dataDir, env } = await setup()
    const spy = vi.spyOn(ai.image!, 'generate')
    const h = imageJobHandler({ ai, dataDir, env })
    const e1 = await run(db, h, { ...payload, purpose: 'illustration', description: 'Saab 37 Viggen' }).catch((x) => x)
    expect(failure(e1)).toMatchObject({ code: 'factual_reference', retryable: false })
    const e2 = await run(db, h, { ...payload, purpose: 'illustration', description: 'en läskig zombie' }).catch(
      (x) => x,
    )
    expect(failure(e2)).toMatchObject({ code: 'unsafe_content' })
    expect(spy).not.toHaveBeenCalled()
    expect(await imagesToday(db)).toBe(0)
  })
})

describe('illustrationJobsFor', () => {
  it('enqueues image jobs per slot and refuses factual ones', async () => {
    const { db } = await setup()
    const artifactId = crypto.randomUUID()
    const out = await illustrationJobsFor(
      [
        { artifactId, path: 'sections.0', description: 'tre tåg', purpose: 'counting', count: 3 },
        { artifactId, path: 'sections.0.items.0', description: 'Europakarta', purpose: 'illustration' },
      ],
      { enqueue: (i) => enqueue(db, i), style: early, subject: 'matematik' },
    )
    expect(out[0]!.jobId).toBeDefined()
    expect(out[1]).toMatchObject({ refused: 'factual_reference' })
  })
})

describe('image routes', () => {
  it('are adult-only, enqueue a job and report limits', async () => {
    vi.stubEnv('LIMIT_IMAGES_PER_DAY', '5')
    const t = await createTestApp()
    cleanup = t.close
    const l = await seedLearner(t.db)
    const url = `/api/v1/learners/${l.id}/images`
    const body = { description: 'en glad dinosaurie' }

    expect((await t.app.inject({ method: 'POST', url, payload: body })).statusCode).toBe(403)
    expect((await t.app.inject('/api/v1/images/limits')).statusCode).toBe(403)

    // No image capability configured on the test app.
    const no = await t.app.inject({ method: 'POST', url, payload: body, headers: asAdult })
    expect(no.statusCode).toBe(409)
    expect(no.json().error.code).toBe('capability_missing')
    expect((await t.app.inject({ url: '/api/v1/images/limits', headers: asAdult })).json()).toMatchObject({
      enabled: false,
      today: 0,
      cap: 5,
    })

    t.app.ctx.ai = createAi(AI_ENV, { db: t.db, log: quiet })
    const ok = await t.app.inject({ method: 'POST', url, payload: body, headers: asAdult })
    expect(ok.statusCode).toBe(202)
    const job = await t.app.inject(`/api/v1/jobs/${ok.json().jobId}`)
    expect(job.json()).toMatchObject({ type: 'image.generate', state: 'queued' })

    const factual = await t.app.inject({
      method: 'POST',
      url,
      payload: { description: 'Europakarta' },
      headers: asAdult,
    })
    expect(factual.statusCode).toBe(422)
    expect(factual.json().error.code).toBe('factual_reference')
    expect((await t.app.inject({ url: '/api/v1/images/limits', headers: asAdult })).json()).toMatchObject({
      enabled: true,
    })
  })
})
