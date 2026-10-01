import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq, gt } from 'drizzle-orm'
import { pino } from 'pino'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProcessedStudyMaterial, StudySet } from '../../shared/contracts'
import { createAi } from '../ai'
import type { MockScripts } from '../ai/mock'
import { makeItems } from '../curriculum/import'
import { syncCurriculumSnapshot } from '../curriculum/service'
import type { Db } from '../db/client'
import { jobs, learners, studyPageExtractions, studyPages, studySets } from '../db/schema'
import { getJob, JobFailure, toJobError, type JobTools } from '../jobs'
import { asAdult, createTestApp, seedLearner, TEST_ENV } from '../test/helpers'
import { cleanupUploads, gcExtractions, studyHandlers } from './process'
import { sniff, uploadDir } from './service'

const hasPoppler = (() => {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** Minimal valid PDF with one Helvetica text line per page. */
function tinyPdf(texts: string[]) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>']
  objs.push(`<< /Type /Pages /Kids [${texts.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${texts.length} >>`)
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (const t of texts) {
    const s = `BT /F1 12 Tf 10 150 Td (${t}) Tj ET`
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length + 2} 0 R >>`,
    )
    objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`)
  }
  let out = '%PDF-1.4\n'
  const offs = objs.map((o, i) => {
    const at = out.length
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
    return at
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const image = (color: string) =>
  sharp({ create: { width: 40, height: 30, channels: 3, background: color } })
    .jpeg()
    .toBuffer()

function form(files: [string, Buffer][], fields: Record<string, string> = {}) {
  const b = '----jacktest'
  const parts = [
    ...Object.entries(fields).map(([k, v]) =>
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    ),
    ...files.map(([name, data]) =>
      Buffer.concat([
        Buffer.from(
          `--${b}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        data,
        Buffer.from('\r\n'),
      ]),
    ),
  ]
  return {
    payload: Buffer.concat([...parts, Buffer.from(`--${b}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}` },
  }
}

let t: Awaited<ReturnType<typeof createTestApp>>
let db: Db
let learnerId: string
const log = pino({ level: 'silent' })

beforeAll(async () => {
  TEST_ENV.DATA_DIR = mkdtempSync(join(tmpdir(), 'jackapp-study-'))
  t = await createTestApp()
  db = t.db
  learnerId = (await seedLearner(db)).id
  await syncCurriculumSnapshot(db, {
    source: 'skolverket',
    version: '2026-01-01',
    retrievedAt: '2026-01-01T08:00:00.000Z',
    apiVersion: 'test',
    licence: 'CC0 1.0',
    sourceUrls: ['https://api.skolverket.se/syllabus/v1/subjects/GRGRNOR01'],
    subjects: [
      {
        code: 'GRGRNOR01',
        name: 'Biologi',
        stage: 'grundskola',
        applicableYears: [1, 2, 3],
        syllabusType: 'COURSE_SYLLABUS',
        categories: [],
        schoolTypes: ['GR'],
        purpose: 'Syfte.',
        courses: [],
        sourceUrl: 'https://api.skolverket.se/syllabus/v1/subjects/GRGRNOR01',
        items: makeItems('GRGRNOR01', [
          { kind: 'central_content', span: '1-3', area: 'Natur', text: 'Djur och växter i närmiljön.' },
        ]),
      },
    ],
  })
})
afterAll(() => t.close())
afterEach(() => vi.unstubAllEnvs())

async function upload(files: [string, Buffer][], headers: Record<string, string> = asAdult) {
  const f = form(files, { title: 'Djur' })
  return t.app.inject({
    method: 'POST',
    url: `/api/v1/learners/${learnerId}/study-sets`,
    payload: f.payload,
    headers: { ...f.headers, ...headers },
  })
}

let visionCalls = 0
let textOutput: unknown
let visionOutput: (call: number) => unknown

beforeEach(() => {
  visionCalls = 0
  visionOutput = () => ({ segments: [{ kind: 'text', text: 'Djur och växter i skogen.', confidence: 'high' }] })
  textOutput = {
    language: 'sv',
    subjectCode: 'GRGRNOR01',
    topic: 'Djur',
    summary: 'Om djur.',
    concepts: ['djur'],
    curriculumRefs: [0, 7],
  }
})

function deps(vision = true) {
  const mock: MockScripts = {
    vision: (_req, call) => (visionCalls++, visionOutput(call)),
    text: () => textOutput,
  }
  const env = {
    AI_TEXT_PROVIDER: 'mock',
    AI_TEXT_MODEL: 'mock-text',
    ...(vision ? { AI_VISION_PROVIDER: 'mock', AI_VISION_MODEL: 'mock-vision' } : {}),
  }
  return { db, env: TEST_ENV, ai: createAi(env, { db, log, mock }), log }
}

/** Runs study.process for an uploaded set's job, like the worker would. */
async function process(jobId: string, vision = true, ctrl = new AbortController(), onStep = (_s: string) => {}) {
  const job = (await getJob(db, jobId))!
  const steps: string[] = []
  const tools: JobTools = {
    db,
    log,
    signal: ctrl.signal,
    progress: async (_p, s) => void (steps.push(s!), onStep(s!)),
    fail: (code, msg, retryable) => {
      throw new JobFailure(code, msg, retryable)
    },
  }
  const handler = studyHandlers(deps(vision)).find((h) => h.type === 'study.process')!
  const r = await handler.run({ ...job, attempts: 1 }, tools).then(
    (id) => ({ id, error: undefined }),
    (e: unknown) => ({
      id: undefined,
      error: toJobError(e, ctrl.signal, { timeoutRetryable: handler.retryOnTimeout }),
    }),
  )
  return { ...r, steps }
}

const setUrl = (id: string) => `/api/v1/learners/${learnerId}/study-sets/${id}`
const getSet = async (id: string) => StudySet.parse((await t.app.inject(setUrl(id))).json().set)

describe('upload', () => {
  it('is adult-only for mutations; reads are open', async () => {
    const res = await upload([['a.jpg', await image('#fff')]], {})
    expect(res.statusCode).toBe(403)
    const ok = await upload([['a.jpg', await image('#fff')]])
    const id = ok.json().set.id
    for (const [method, url] of [
      ['PATCH', `${setUrl(id)}/pages`],
      ['POST', `${setUrl(id)}/reprocess`],
      ['DELETE', setUrl(id)],
    ] as const)
      expect((await t.app.inject({ method, url, payload: { order: [1] } })).statusCode).toBe(403)
    expect((await t.app.inject(`/api/v1/learners/${learnerId}/study-sets`)).statusCode).toBe(200)
  })

  it('lets middle/upper-band learners upload when their profile allows requests; early band stays adult-only', async () => {
    const post = async (id: string) => {
      const f = form([['a.jpg', await image('#eee')]])
      return t.app.inject({ method: 'POST', url: `/api/v1/learners/${id}/study-sets`, ...f })
    }
    const year5 = await seedLearner(db, { stage: 'grundskola', year: 5 })
    const res = await post(year5.id)
    expect(res.statusCode).toBe(201)
    expect(res.json().jobId).toBeTruthy()

    const p = year5.profile
    await db
      .update(learners)
      .set({ profile: { ...p, generation: { ...p.generation, learnerRequestsAllowed: false } } })
      .where(eq(learners.id, year5.id))
    expect((await post(year5.id)).statusCode).toBe(403)
    expect((await post(learnerId)).statusCode).toBe(403) // year 1: early band
  })

  it('checks real types by magic bytes and rejects HEIC with a clear message', async () => {
    expect(sniff(Buffer.from('%PDF-1.4'))).toBe('application/pdf')
    const fake = await upload([['photo.jpg', Buffer.from('not really a jpeg')]])
    expect(fake.statusCode).toBe(400)
    expect(fake.json().error.code).toBe('unsupported_type')
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(16)])
    const res = await upload([['IMG_1.HEIC', heic]])
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/HEIC.*JPEG/)
    // Rejected uploads leave nothing behind.
    const rows = await db.select().from(studySets).where(eq(studySets.status, 'uploading'))
    expect(rows).toEqual([])
  })

  it('enforces file, total and page limits (413)', async () => {
    const jpeg = (mb: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(mb * 1024 * 1024)])
    vi.stubEnv('LIMIT_UPLOAD_FILE_MB', '1')
    let res = await upload([['big.jpg', jpeg(1.2)]])
    expect([res.statusCode, res.json().error.code]).toEqual([413, 'file_too_large'])

    vi.stubEnv('LIMIT_UPLOAD_TOTAL_MB', '1')
    res = await upload([
      ['a.jpg', jpeg(0.6)],
      ['b.jpg', jpeg(0.6)],
    ])
    expect([res.statusCode, res.json().error.code]).toEqual([413, 'upload_too_large'])

    vi.stubEnv('LIMIT_UPLOAD_PAGES', '2')
    const small = await image('#eee')
    res = await upload([
      ['a.jpg', small],
      ['b.jpg', small],
      ['c.jpg', small],
    ])
    expect([res.statusCode, res.json().error.code]).toEqual([413, 'too_many_pages'])
    if (hasPoppler) {
      res = await upload([['three.pdf', tinyPdf(['a', 'b', 'c'])]])
      expect([res.statusCode, res.json().error.code]).toEqual([413, 'too_many_pages'])
    }
  })
})

describe.skipIf(!hasPoppler)('processing', () => {
  it('orders files and PDF pages, reorders, extracts per page and stores provenance', async () => {
    const res = await upload([
      ['first.jpg', await image('#f00')],
      ['two.pdf', tinyPdf(['Djur i skogen', 'Vaxter'])],
      [
        'last.png',
        await sharp(await image('#00f'))
          .png()
          .toBuffer(),
      ],
    ])
    expect(res.statusCode).toBe(201)
    const { set, jobId } = res.json()
    expect(set.status).toBe('queued')
    expect(set.pages.map((p: { mimeType: string; pdfPage?: number }) => [p.mimeType, p.pdfPage])).toEqual([
      ['image/jpeg', undefined],
      ['application/pdf', 1],
      ['application/pdf', 2],
      ['image/png', undefined],
    ])
    expect((await getJob(db, jobId))!.dedupeKey).toBe(`study.process:${set.id}`)

    const re = await t.app.inject({
      method: 'PATCH',
      url: `${setUrl(set.id)}/pages`,
      headers: asAdult,
      payload: { order: [4, 1, 2, 3] },
    })
    expect(re.json().pages.map((p: { mimeType: string }) => p.mimeType)).toEqual([
      'image/png',
      'image/jpeg',
      'application/pdf',
      'application/pdf',
    ])

    const r = await process(jobId)
    expect(r.error).toBeUndefined()
    expect(r.steps).toContain('Läser sida 3 av 4')
    expect(visionCalls).toBe(4)
    const done = await getSet(set.id)
    expect(done.status).toBe('ready')
    expect(done.pages.every((p) => p.sourceDeleted)).toBe(true)
    expect(existsSync(uploadDir(TEST_ENV.DATA_DIR, set.id))).toBe(false)

    const adult = (await t.app.inject({ url: `${setUrl(set.id)}/material`, headers: asAdult })).json()
    const m = ProcessedStudyMaterial.parse(adult)
    expect(m.segments.map((s) => [s.id, s.page])).toEqual([
      ['p1s1', 1],
      ['p2s1', 2],
      ['p3s1', 3],
      ['p4s1', 4],
    ])
    expect(m.subjectGuess).toBe('GRGRNOR01')
    expect(m.curriculumRefs).toHaveLength(1) // index 7 was not a candidate
    expect(adult.provenance).toEqual({
      method: 'vision',
      visionModel: 'mock-vision',
      textModel: 'mock-text',
      pages: 4,
      cachedPages: 0,
    })
    const learner = (await t.app.inject(`${setUrl(set.id)}/material`)).json()
    expect(learner.provenance).toBeUndefined()
    expect(learner.segments).toHaveLength(4)
  })

  it('reuses the per-page cache and keeps originals when the commit fails', async () => {
    const img = await image('#0f0')
    const a = (await upload([['a.jpg', img]])).json()
    expect((await process(a.jobId)).error).toBeUndefined()
    expect(visionCalls).toBe(1)

    const b = (await upload([['again.jpg', img]])).json()
    const spy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('db down'))
    const failed = await process(b.jobId)
    spy.mockRestore()
    expect(failed.error?.code).toBe('internal')
    expect(visionCalls).toBe(1) // cache hit, no second vision call
    expect((await getSet(b.set.id)).status).toBe('failed')
    expect(readdirSync(uploadDir(TEST_ENV.DATA_DIR, b.set.id))).toHaveLength(1)

    await db.update(jobs).set({ state: 'failed' }).where(eq(jobs.id, b.jobId))
    const again = await t.app.inject({ method: 'POST', url: `${setUrl(b.set.id)}/reprocess`, headers: asAdult })
    expect(again.statusCode).toBe(202)
    expect((await process(again.json().jobId)).error).toBeUndefined()
    expect(visionCalls).toBe(1)
    const prov = (await t.app.inject({ url: `${setUrl(b.set.id)}/material`, headers: asAdult })).json().provenance
    expect(prov.cachedPages).toBe(1)
    expect(existsSync(uploadDir(TEST_ENV.DATA_DIR, b.set.id))).toBe(false)
    const ready = await t.app.inject({ method: 'POST', url: `${setUrl(b.set.id)}/reprocess`, headers: asAdult })
    expect(ready.statusCode).toBe(409)
  })

  it('scales the timeout by page count; a timed-out run never commits and is requeued', async () => {
    const s = (await upload([['t.jpg', await image('#321')]])).json()
    const handler = studyHandlers(deps()).find((h) => h.type === 'study.process')!
    const job = (await getJob(db, s.jobId))!
    expect(await handler.timeoutMs!(job, db)).toBe(1_200_000) // 1 page: the default floor
    await db.insert(studyPages).values(
      Array.from({ length: 79 }, (_, i) => ({
        setId: s.set.id,
        page: i + 2,
        file: 'x',
        mimeType: 'image/jpeg',
        bytes: 1,
        sha256: 'x',
      })),
    )
    expect(await handler.timeoutMs!(job, db)).toBe(80 * 60_000)
    await db.delete(studyPages).where(and(eq(studyPages.setId, s.set.id), gt(studyPages.page, 1)))

    const ctrl = new AbortController()
    const r = await process(s.jobId, true, ctrl, (step) => step === 'Sparar materialet' && ctrl.abort('timeout'))
    expect(r.error).toMatchObject({ code: 'timeout', retryable: true })
    expect((await getSet(s.set.id)).status).toBe('queued') // requeued, not failed
    expect((await t.app.inject({ url: `${setUrl(s.set.id)}/material`, headers: asAdult })).statusCode).toBe(409)
  })

  it('fails cleanly on invalid model output and keeps the originals', async () => {
    visionOutput = () => ({ segments: [{ kind: 'nonsense', text: 1 }] })
    const s = (await upload([['x.jpg', await image('#123')]])).json()
    const r = await process(s.jobId)
    expect(r.error).toMatchObject({ code: 'ai_invalid_output', retryable: false })
    const set = await getSet(s.set.id)
    expect(set.status).toBe('failed')
    expect(set.failure).toMatch(/AI-svaret/)
    expect(existsSync(uploadDir(TEST_ENV.DATA_DIR, s.set.id))).toBe(true)
  })

  it('uses the PDF text layer without vision, and refuses images without vision', async () => {
    const pdf = (await upload([['text.pdf', tinyPdf(['Djur och vaxter i narmiljon pa sidan ett'])]])).json()
    const r = await process(pdf.jobId, false)
    expect(r.error).toBeUndefined()
    const m = (await t.app.inject({ url: `${setUrl(pdf.set.id)}/material`, headers: asAdult })).json()
    expect(m.provenance.method).toBe('text-layer')
    expect(m.segments[0].text).toMatch(/Djur och vaxter/)

    const img = (await upload([['p.jpg', await image('#456')]])).json()
    const f = await process(img.jobId, false)
    expect(f.error?.adultMessage).toBe('Bildtolkning (AI-vision) är inte konfigurerad.')
  })
})

describe('cleanup', () => {
  it('purges failed originals after retention, never a processing set, and removes orphans', async () => {
    const mk = async (color: string) => (await upload([['c.jpg', await image(color)]])).json().set.id as string
    const failed = await mk('#a00')
    const processing = await mk('#0a0')
    const fresh = await mk('#00a')
    const old = new Date(Date.now() - 200 * 3_600_000)
    await db.update(studySets).set({ status: 'failed', failedAt: old }).where(eq(studySets.id, failed))
    await db.update(studySets).set({ status: 'processing', updatedAt: old }).where(eq(studySets.id, processing))
    await db.update(studySets).set({ status: 'failed', failedAt: new Date() }).where(eq(studySets.id, fresh))
    const orphan = join(uploadDir(TEST_ENV.DATA_DIR), '00000000-0000-4000-8000-000000000000')
    mkdirSync(orphan, { recursive: true })
    utimesSync(orphan, old, old)

    const r = await cleanupUploads(db, TEST_ENV.DATA_DIR, 168)
    expect(r.orphans).toBeGreaterThanOrEqual(1)
    expect(existsSync(uploadDir(TEST_ENV.DATA_DIR, failed))).toBe(false)
    expect(existsSync(uploadDir(TEST_ENV.DATA_DIR, processing))).toBe(true) // its job is still active
    expect(existsSync(uploadDir(TEST_ENV.DATA_DIR, fresh))).toBe(true)
    expect(existsSync(orphan)).toBe(false)
    expect((await getSet(failed)).pages[0]!.sourceDeleted).toBe(true)
    const res = await t.app.inject({ method: 'POST', url: `${setUrl(failed)}/reprocess`, headers: asAdult })
    expect(res.statusCode).toBe(409)
  })

  it("keeps a slow upload that is still streaming; removes a deleted learner's originals and stale cache", async () => {
    const old = new Date(Date.now() - 3 * 3_600_000)
    const [slow] = await db
      .insert(studySets)
      .values({ learnerId, title: 'x', status: 'uploading', createdAt: old, updatedAt: new Date() })
      .returning()
    mkdirSync(uploadDir(TEST_ENV.DATA_DIR, slow!.id), { recursive: true })

    const other = await seedLearner(db)
    const [gone] = await db.insert(studySets).values({ learnerId: other.id, title: 'y', status: 'ready' }).returning()
    const goneDir = uploadDir(TEST_ENV.DATA_DIR, gone!.id)
    mkdirSync(goneDir, { recursive: true })
    await db.delete(learners).where(eq(learners.id, other.id)) // cascades rows only
    utimesSync(goneDir, old, old)
    await db
      .insert(studyPageExtractions)
      .values({
        sha256: 'f'.repeat(64),
        pdfPage: 0,
        segments: [],
        model: 'm',
        createdAt: new Date(Date.now() - 30 * 3_600_000),
      })

    await cleanupUploads(db, TEST_ENV.DATA_DIR, 168)
    expect(existsSync(uploadDir(TEST_ENV.DATA_DIR, slow!.id))).toBe(true)
    expect((await db.select().from(studySets).where(eq(studySets.id, slow!.id))).length).toBe(1)
    expect(existsSync(goneDir)).toBe(false)
    expect(await gcExtractions(db)).toBeGreaterThanOrEqual(1)
    expect(
      await db
        .select()
        .from(studyPageExtractions)
        .where(eq(studyPageExtractions.sha256, 'f'.repeat(64))),
    ).toEqual([])
  })

  it('deletes a set with everything it owns', async () => {
    const s = (await upload([['d.jpg', await image('#789')]])).json()
    const res = await t.app.inject({ method: 'DELETE', url: setUrl(s.set.id), headers: asAdult })
    expect(res.statusCode).toBe(204)
    expect(existsSync(uploadDir(TEST_ENV.DATA_DIR, s.set.id))).toBe(false)
    expect((await t.app.inject(setUrl(s.set.id))).statusCode).toBe(404)
    expect((await getJob(db, s.jobId))!.state).toBe('cancelled')
  })
})
