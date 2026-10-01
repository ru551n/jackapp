import multipart from '@fastify/multipart'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { and, desc, eq, inArray, isNull, notExists } from 'drizzle-orm'
import { z } from 'zod'
import { loadProcessedMaterial } from './material'
import type { RouteModule } from '../app/context'
import { parseEnv } from '../config/env'
import { LimitsEnv } from '../config/limits'
import { studyPageExtractions, studyPages, studySets } from '../db/schema'
import { HttpError, requireAdult, requireLearner } from '../gate/guards'
import { getJob, jobsServices } from '../jobs'
import { pdfPageCount, processDedupeKey, removeOriginals, sniff, toStudySet, uploadDir } from './service'

const MB = 1024 * 1024
const LearnerParams = z.object({ id: z.string().uuid() })
const SetParams = z.object({ id: z.string().uuid(), setId: z.string().uuid() })
const err = (status: number, code: string, message: string) => new HttpError(status, code, message)

type NewPage = Omit<typeof studyPages.$inferInsert, 'setId'>

export const studyRoutes: RouteModule = async (app, ctx) => {
  const { db, env } = ctx
  const jobs = ctx.jobs ?? jobsServices(ctx)

  async function loadSet(params: unknown) {
    const { id, setId } = SetParams.parse(params)
    const [set] = await db
      .select()
      .from(studySets)
      .where(and(eq(studySets.id, setId), eq(studySets.learnerId, id)))
    if (!set) throw err(404, 'not_found', 'Hittades inte.')
    return set
  }

  async function startProcessing(setId: string, learnerId: string) {
    try {
      const job = await jobs.enqueue({
        type: 'study.process',
        payload: { setId },
        learnerId,
        dedupeKey: processDedupeKey(setId),
      })
      await db.update(studySets).set({ jobId: job.id, updatedAt: new Date() }).where(eq(studySets.id, setId))
      return job.id
    } catch (e) {
      // Queue full: keep the originals so the adult can reprocess later.
      const failure = e instanceof HttpError ? e.message : 'Bearbetningen kunde inte starta.'
      await db
        .update(studySets)
        .set({ status: 'failed', failure, failedAt: new Date(), updatedAt: new Date() })
        .where(eq(studySets.id, setId))
      throw e
    }
  }

  await app.register(async (s) => {
    await s.register(multipart, { throwFileSizeLimit: false })

    /** Upload one ordered study set (adult). Files are streamed to DATA_DIR/uploads/<setId>/. */
    s.post('/learners/:id/study-sets', async (req, reply) => {
      requireAdult(req)
      const learner = await requireLearner(db, LearnerParams.parse(req.params).id)
      if (!req.isMultipart()) throw err(400, 'invalid_request', 'Skicka filerna som ett formulär (multipart).')
      const lim = parseEnv(LimitsEnv)
      const [set] = await db
        .insert(studySets)
        .values({ learnerId: learner.id, title: 'Studiematerial', status: 'uploading' })
        .returning()
      const dir = uploadDir(env.DATA_DIR, set!.id)
      await mkdir(dir, { recursive: true })
      try {
        const pages: NewPage[] = []
        let title: string | undefined
        let total = 0
        let fileNo = 0
        const parts = req.parts({
          limits: { fileSize: lim.LIMIT_UPLOAD_FILE_MB * MB, files: lim.LIMIT_UPLOAD_PAGES, fields: 10 },
        })
        for await (const part of parts) {
          if (part.type === 'field') {
            if (part.fieldname === 'title') title = String(part.value).trim().slice(0, 200) || undefined
            continue
          }
          const file = `${++fileNo}.upload`
          const hash = createHash('sha256')
          let bytes = 0
          await pipeline(
            part.file,
            async function* (src: AsyncIterable<Buffer>) {
              for await (const chunk of src) {
                hash.update(chunk)
                bytes += chunk.length
                if (total + bytes > lim.LIMIT_UPLOAD_TOTAL_MB * MB)
                  throw err(413, 'upload_too_large', `Materialet är större än ${lim.LIMIT_UPLOAD_TOTAL_MB} MB totalt.`)
                yield chunk
              }
            },
            createWriteStream(join(dir, file)),
          )
          total += bytes
          if (part.file.truncated)
            throw err(413, 'file_too_large', `Filen ”${part.filename}” är större än ${lim.LIMIT_UPLOAD_FILE_MB} MB.`)
          const head = Buffer.alloc(16)
          const fh = await open(join(dir, file))
          await fh.read(head, 0, 16, 0).finally(() => fh.close())
          const type = sniff(head)
          if (type === 'heic')
            throw err(
              400,
              'unsupported_type',
              `”${part.filename}” är en HEIC-bild, som inte stöds. Spara den som JPEG (på iPhone: Inställningar → Kamera → Format → Mest kompatibelt) och försök igen.`,
            )
          if (!type)
            throw err(400, 'unsupported_type', `”${part.filename}” är inte en bild (JPEG, PNG, WEBP) eller en PDF.`)
          const sha256 = hash.digest('hex')
          const base = { file, mimeType: type, bytes, sha256 }
          if (type === 'application/pdf') {
            const n = await pdfPageCount(join(dir, file))
            if (!n) throw err(400, 'upload_unreadable', `PDF-filen ”${part.filename}” gick inte att läsa.`)
            for (let p = 1; p <= n && pages.length <= lim.LIMIT_UPLOAD_PAGES; p++)
              pages.push({ ...base, page: pages.length + 1, pdfPage: p })
          } else pages.push({ ...base, page: pages.length + 1 })
          if (pages.length > lim.LIMIT_UPLOAD_PAGES)
            throw err(413, 'too_many_pages', `Materialet har fler än ${lim.LIMIT_UPLOAD_PAGES} sidor.`)
        }
        if (!pages.length) throw err(400, 'invalid_request', 'Välj minst en bild eller PDF.')
        await db.insert(studyPages).values(pages.map((p) => ({ ...p, setId: set!.id })))
        const [queued] = await db
          .update(studySets)
          .set({ status: 'queued', title: title ?? 'Studiematerial', updatedAt: new Date() })
          .where(eq(studySets.id, set!.id))
          .returning()
        const jobId = await startProcessing(set!.id, learner.id)
        req.log.info({ studySetId: set!.id, pages: pages.length, files: fileNo }, 'study set uploaded')
        return reply.status(201).send({ set: await toStudySet(db, queued!), jobId })
      } catch (e) {
        const [cur] = await db.select().from(studySets).where(eq(studySets.id, set!.id))
        if (cur?.status === 'uploading') {
          await db.delete(studySets).where(eq(studySets.id, set!.id))
          await removeOriginals(env.DATA_DIR, set!.id)
        }
        const code = (e as { code?: string }).code
        if (code === 'FST_FILES_LIMIT')
          throw err(413, 'too_many_pages', `Materialet har fler än ${lim.LIMIT_UPLOAD_PAGES} filer.`)
        if (code === 'FST_FIELDS_LIMIT' || code === 'FST_PARTS_LIMIT')
          throw err(400, 'invalid_request', 'Ogiltig förfrågan.')
        throw e
      }
    })
  })

  /** A learner's study sets, newest first. */
  app.get('/learners/:id/study-sets', async (req) => {
    const learner = await requireLearner(db, LearnerParams.parse(req.params).id)
    const rows = await db
      .select()
      .from(studySets)
      .where(eq(studySets.learnerId, learner.id))
      .orderBy(desc(studySets.createdAt))
    return Promise.all(rows.map((r) => toStudySet(db, r)))
  })

  app.get('/learners/:id/study-sets/:setId', async (req) => {
    const set = await loadSet(req.params)
    return { set: await toStudySet(db, set), jobId: set.jobId ?? undefined }
  })

  /** Reorder pages before processing: `order` lists the current page numbers in their new order. */
  app.patch('/learners/:id/study-sets/:setId/pages', async (req) => {
    requireAdult(req)
    const { order } = z.object({ order: z.array(z.number().int().min(1)).max(1000) }).parse(req.body)
    const set = await loadSet(req.params)
    await db.transaction(async (tx) => {
      // Row lock: the worker's queued→processing update waits for (or precedes) this reorder.
      const [locked] = await tx
        .select({ status: studySets.status })
        .from(studySets)
        .where(eq(studySets.id, set.id))
        .for('update')
      if (!locked || !['queued', 'failed'].includes(locked.status))
        throw err(409, 'not_reorderable', 'Sidorna kan bara ordnas om innan materialet har bearbetats.')
      const pages = await tx.select().from(studyPages).where(eq(studyPages.setId, set.id))
      const sorted = [...order].sort((a, b) => a - b)
      if (sorted.length !== pages.length || sorted.some((p, i) => p !== i + 1))
        throw err(400, 'invalid_request', 'Ordningen måste innehålla varje sida exakt en gång.')
      const byPage = new Map(pages.map((p) => [p.page, p.id]))
      for (const [i, old] of order.entries())
        await tx
          .update(studyPages)
          .set({ page: i + 1 })
          .where(eq(studyPages.id, byPage.get(old)!))
    })
    const [cur] = await db.select().from(studySets).where(eq(studySets.id, set.id))
    return toStudySet(db, cur!)
  })

  /** Retry a failed set; only possible while its originals are kept. */
  app.post('/learners/:id/study-sets/:setId/reprocess', async (req, reply) => {
    requireAdult(req)
    const set = await loadSet(req.params)
    // Atomic with cleanup: the purge claims status='failed' rows with the same row lock.
    const [queued] = await db
      .update(studySets)
      .set({ status: 'queued', failure: null, failedAt: null, updatedAt: new Date() })
      .where(and(eq(studySets.id, set.id), eq(studySets.status, 'failed'), isNull(studySets.sourcesDeletedAt)))
      .returning()
    if (!queued)
      throw err(
        409,
        'not_reprocessable',
        set.status === 'failed'
          ? 'Originalfilerna finns inte kvar. Ladda upp materialet igen.'
          : 'Bara material som misslyckades kan bearbetas igen.',
      )
    const jobId = await startProcessing(set.id, set.learnerId)
    return reply.status(202).send({ set: await toStudySet(db, queued), jobId })
  })

  /** Delete a set with its pages, material, originals and (unshared) extraction cache. */
  app.delete('/learners/:id/study-sets/:setId', async (req, reply) => {
    requireAdult(req)
    const set = await loadSet(req.params)
    const pages = await db.select({ sha256: studyPages.sha256 }).from(studyPages).where(eq(studyPages.setId, set.id))
    if (set.jobId && (await getJob(db, set.jobId))) await jobs.cancel(set.jobId)
    await db.delete(studySets).where(eq(studySets.id, set.id))
    await removeOriginals(env.DATA_DIR, set.id)
    const shas = [...new Set(pages.map((p) => p.sha256))]
    if (shas.length)
      await db
        .delete(studyPageExtractions)
        .where(
          and(
            inArray(studyPageExtractions.sha256, shas),
            notExists(db.select().from(studyPages).where(eq(studyPages.sha256, studyPageExtractions.sha256))),
          ),
        )
    return reply.status(204).send()
  })

  /** The processed representation. Adults also get technical provenance. */
  app.get('/learners/:id/study-sets/:setId/material', async (req) => {
    const set = await loadSet(req.params)
    const loaded = set.status === 'ready' ? await loadProcessedMaterial(db, set.id) : undefined
    if (!loaded) throw err(409, 'not_ready', 'Materialet är inte färdigbearbetat än.')
    const { material, provenance } = loaded
    return req.gate?.adult ? { ...material, provenance } : material
  })
}
