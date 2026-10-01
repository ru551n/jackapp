import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAi } from '../ai'
import { MOCK_PNG } from '../ai/mock'
import type { ChatRequest } from '../ai/types'
import { jobs } from '../db/schema'
import { createWorker, getJob, type Worker } from '../jobs'
import { FetchError, type Fetcher } from '../research/fetch'
import { COMMONS_RESPONSE } from '../research/fixtures'
import { asAdult, createTestApp, seedLearner, TEST_ENV } from '../test/helpers'
import { jobHandlers } from '../worker/handlers'
import { applyJobMedia } from './media'
import { listVersions, loadArtifact } from './store'

// Generation ↔ images through the real worker: illustration requests become image.generate /
// asset.fetch jobs, and their completion hook adds the media as new artifact versions.

const log = { info() {}, warn() {}, error() {}, debug() {}, child: () => log } as never

const ILLUSTRATIONS = [
  'Ett glatt tåg med tre vagnar',
  'Saab 37 Viggen på en flygbas',
  'en pistol på ett bord',
  undefined,
]

function mockText(req: ChatRequest) {
  const js = req.json!.jsonSchema as { properties: { items: { minItems: number } } }
  return {
    title: 'Fordon',
    items: Array.from({ length: js.properties.items.minItems }, (_, n) => ({
      kind: 'trueFalse',
      prompt: `Påstående ${n + 1}`,
      difficulty: 2,
      skills: ['math.counting'],
      answer: true,
      illustration: ILLUSTRATIONS[n % 4],
    })),
  }
}

/** Fake network: Commons search + image downloads; everything else is unreachable. */
const fetcher: Fetcher = async (url) => {
  if (url.startsWith('https://commons.wikimedia.org/w/api.php?'))
    return { url, status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(COMMONS_RESPONSE)) }
  if (url.startsWith('https://upload.wikimedia.org/'))
    return { url, status: 200, contentType: 'image/png', body: Buffer.concat([MOCK_PNG, Buffer.from(url)]) }
  throw new FetchError('http_status', 'HTTP 404')
}

let worker: Worker | undefined
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  vi.unstubAllEnvs()
  await worker?.stop(1000)
  await close?.()
  worker = close = undefined
})

async function setup(text: (req: ChatRequest) => unknown = mockText, image = true) {
  const t = await createTestApp()
  close = t.close
  const learner = await seedLearner(t.db)
  const ai = createAi(
    {
      AI_TEXT_PROVIDER: 'mock',
      ...(image ? { AI_IMAGE_PROVIDER: 'mock' } : {}),
      LIMIT_AI_REQUESTS_PER_HOUR: '10000',
    },
    { db: t.db, log, mock: { text } },
  )
  const env = { ...TEST_ENV, DATA_DIR: mkdtempSync(join(tmpdir(), 'jackapp-media-')) }
  const handlers = jobHandlers({ db: t.db, env, ai, log, net: { fetcher } })
  const start = async () => {
    worker = createWorker({ db: t.db, log, handlers, pollMs: 20, heartbeatMs: 1000, schedules: [] })
    await worker.start()
  }
  return { ...t, learnerId: learner.id, ai, start }
}

async function until(fn: () => Promise<boolean>, ms = 30_000) {
  const end = Date.now() + ms
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 25))
  }
}

const allJobs = async (db: Awaited<ReturnType<typeof setup>>['db']) => db.select().from(jobs)
const finished = (s: string) => s === 'completed' || s === 'failed'

describe('generation → images → artifact versions', () => {
  it('draws decorative slots, fetches licensed images for factual ones and applies both as versions', async () => {
    const t = await setup()
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/learners/${t.learnerId}/generate`,
      headers: asAdult,
      payload: { type: 'exercises', questionCount: 4, itemKinds: ['trueFalse'], includeImages: true },
    })
    expect(res.statusCode).toBe(202)
    await t.start()
    await until(async () => {
      const all = await allJobs(t.db)
      return all.length === 3 && all.every((j) => finished(j.state))
    })
    const all = await allJobs(t.db)
    expect(all.map((j) => [j.type, j.state]).sort()).toEqual([
      ['artifact.generate', 'completed'],
      ['asset.fetch', 'completed'],
      ['image.generate', 'completed'],
    ]) // the unsafe "pistol" slot got no job at all
    const artifactId = all.find((j) => j.type === 'artifact.generate')!.resultId!
    await until(async () => (await loadArtifact(t.db, artifactId))!.artifact.version === 3)

    const { artifact } = (await loadArtifact(t.db, artifactId))!
    const items = artifact.sections.flatMap((s) => s.items)
    expect(items[0]!.media).toEqual([
      expect.objectContaining({ generated: true, alt: `AI-genererad bild: ${ILLUSTRATIONS[0]}` }),
    ])
    expect(items[1]!.media).toEqual([
      expect.objectContaining({ generated: false, license: expect.objectContaining({ autoUsable: true }) }),
    ])
    expect(items[2]!.media).toEqual([])
    expect(artifact.validation.ok).toBe(true)
    expect(artifact.approval).toBe('approved')
    expect((await listVersions(t.db, artifactId)).map((v) => v.origin)).toEqual(['media', 'media', 'generate'])

    // Adult view: only the refused (unsafe) request is still open.
    const view = (await t.app.inject({ url: `/api/v1/artifacts/${artifactId}`, headers: asAdult })).json()
    expect(view.requestedIllustrations).toEqual([{ itemId: items[2]!.id, description: ILLUSTRATIONS[2] }])
    // Provenance: every shown asset, with its licence record.
    expect(view.assetIds.sort()).toEqual([items[0]!.media[0]!.assetId, items[1]!.media[0]!.assetId].sort())
    const prov = await t.app.inject({ url: `/api/v1/research/provenance?assetIds=${view.assetIds}`, headers: asAdult })
    expect(
      prov
        .json()
        .assets.map((x: { generated: boolean }) => x.generated)
        .sort(),
    ).toEqual([false, true])

    // Idempotent: replaying a completion adds nothing.
    const image = all.find((j) => j.type === 'image.generate')!
    await applyJobMedia((await getJob(t.db, image.id))!, image.resultId!, { db: t.db, log })
    expect((await loadArtifact(t.db, artifactId))!.artifact.version).toBe(3)

    // A request that no longer stands (description changed, e.g. by a transform) is skipped.
    const stale = { ...image, payload: { ...image.payload, description: 'något helt annat' } }
    await applyJobMedia(stale, image.resultId!, { db: t.db, log })
    expect((await loadArtifact(t.db, artifactId))!.artifact.version).toBe(3)
  }, 120_000)

  it('leaves the artifact usable without images when image jobs fail', async () => {
    const t = await setup()
    t.ai.image!.generate = async () => ({ images: [], model: 'mock' }) // → ai_invalid_output, not retried
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/learners/${t.learnerId}/generate`,
      headers: asAdult,
      payload: { type: 'exercises', questionCount: 1, itemKinds: ['trueFalse'], support: { visualSupport: 'high' } },
    })
    await t.start()
    await until(async () => {
      const all = await allJobs(t.db)
      return all.length === 2 && all.every((j) => finished(j.state))
    })
    const [gen] = await t.db.select().from(jobs).where(eq(jobs.type, 'artifact.generate'))
    const [img] = await t.db.select().from(jobs).where(eq(jobs.type, 'image.generate'))
    expect(img!.state).toBe('failed')
    expect(img!.lastError).toMatchObject({ code: 'ai_invalid_output' })
    const stored = (await loadArtifact(t.db, gen!.resultId!))!
    expect(stored.artifact.version).toBe(1)
    // A learner can open and run it right away.
    const learnerView = await t.app.inject(`/api/v1/artifacts/${gen!.resultId}`)
    expect(learnerView.statusCode).toBe(200)
    expect(learnerView.json().artifact.sections[0].items[0].media).toEqual([])
  }, 120_000)
})

/** An early-learner picture question: concrete choices with search terms, as the prompt asks for. */
function pictureText(req: ChatRequest) {
  const js = req.json!.jsonSchema as { properties: { items: { minItems: number } } }
  return {
    title: 'Saker',
    items: Array.from({ length: js.properties.items.minItems }, () => ({
      kind: 'multipleChoice',
      prompt: 'Vilken kan man äta?',
      difficulty: 1,
      skills: ['swedish.words'],
      choices: ['tåg', 'äpple', 'katt'],
      correctIndex: 1,
      illustration: 'Ett rött äpple',
      imageQuery: 'red apple',
      choiceImageQueries: ['train', 'apple', 'cat'],
    })),
  }
}

describe('"Mer bildstöd" without image generation', () => {
  async function moreVisual(t: Awaited<ReturnType<typeof setup>>) {
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/learners/${t.learnerId}/generate`,
      headers: asAdult,
      payload: { type: 'exercises', questionCount: 1, itemKinds: ['multipleChoice'] },
    })
    await t.start()
    await until(async () => (await allJobs(t.db)).some((j) => j.state === 'completed'))
    const artifactId = (await allJobs(t.db))[0]!.resultId!
    expect((await allJobs(t.db)).map((j) => j.type)).toEqual(['artifact.generate']) // no images asked for yet
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/artifacts/${artifactId}/transform`,
      headers: asAdult,
      payload: { kind: 'moreVisual' },
    })
    expect(res.statusCode).toBe(202)
    await until(async () => {
      const all = await allJobs(t.db)
      return all.filter((j) => j.type === 'artifact.generate').length === 2 && all.every((j) => finished(j.state))
    })
    return artifactId
  }

  it('falls back to licensed images for the item and its concrete choices', async () => {
    const t = await setup(pictureText, false)
    const artifactId = await moreVisual(t)
    const fetches = (await allJobs(t.db)).filter((j) => j.type !== 'artifact.generate')
    expect(fetches.map((j) => [j.type, j.state, (j.payload as { query: string }).query]).sort()).toEqual([
      ['asset.fetch', 'completed', 'apple'],
      ['asset.fetch', 'completed', 'cat'],
      ['asset.fetch', 'completed', 'red apple'],
      ['asset.fetch', 'completed', 'train'],
    ])
    // generate, transform, then one media version per picture
    await until(async () => (await loadArtifact(t.db, artifactId))!.artifact.version === 6)
    const { artifact } = (await loadArtifact(t.db, artifactId))!
    const item = artifact.sections[0]!.items[0]!
    const licensed = expect.objectContaining({
      generated: false,
      license: expect.objectContaining({ autoUsable: true }),
    })
    expect(item.media).toEqual([licensed])
    expect('choices' in item && item.choices.map((c) => c.media)).toEqual([licensed, licensed, licensed])
    expect(artifact.validation.ok).toBe(true)
    // The learner gets the pictures too.
    const learnerView = (await t.app.inject(`/api/v1/artifacts/${artifactId}`)).json()
    expect(learnerView.artifact.sections[0].items[0].media).toHaveLength(1)
  }, 120_000)

  it('enqueues no image jobs when no image source exists (the adult UI says so)', async () => {
    vi.stubEnv('FEATURE_EXTERNAL_ASSETS', 'false')
    const t = await setup(pictureText, false)
    const artifactId = await moreVisual(t)
    expect((await allJobs(t.db)).map((j) => j.type)).toEqual(['artifact.generate', 'artifact.generate'])
    expect((await loadArtifact(t.db, artifactId))!.artifact.version).toBe(2)
  }, 120_000)
})
