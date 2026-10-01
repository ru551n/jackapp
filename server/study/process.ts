import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ProcessedStudyMaterial, StudySegment } from '../../shared/contracts'
import { AiError } from '../ai'
import { isValidRef, subjectsFor, suggestRefs } from '../curriculum/service'
import { parseEnv } from '../config/env'
import { LimitsEnv } from '../config/limits'
import type { Db } from '../db/client'
import {
  jobs,
  learners,
  studyMaterials,
  studyPageExtractions,
  studyPages,
  studySegments,
  studySets,
} from '../db/schema'
import { defineJobHandler, JobFailure, type JobHandler, type JobTools } from '../jobs'
import type { HandlerDeps } from '../worker/handlers'
import { removeOriginals, run, uploadDir } from './service'

// study.process (upload → normalized page images → vision per page → one text call → store)
// and uploads.cleanup. Lifecycle and guarantees: docs/platform/uploads.md.

const PageExtraction = z.object({ segments: z.array(StudySegment.omit({ id: true, page: true })).max(80) })
type Extracted = z.infer<typeof PageExtraction>['segments']
type PageRow = typeof studyPages.$inferSelect

const MAX_SIDE = 2000
const MIN_TEXT_LAYER_CHARS = 20
/** ponytail: the understanding call sees at most this much text; chunk + merge summaries if sets get huge. */
const MAX_UNDERSTAND_CHARS = 60_000
const HOUR = 3_600_000

const VISION_SYSTEM = `Du läser en sida ur studiematerial (lärobok, stencil, anteckningar) åt en svensk skolelev.
Dela upp sidan i segment i läsordning. Regler:
- Transkribera texten troget och ordagrant, på originalspråket. Rätta, förkorta eller hitta inte på något.
- kind: heading, text, definition, vocabulary (glosor), formula, example, question, list, table, diagram, map, image, handwriting.
- vocabulary: lägg paren i data.pairs som [{"term": "...", "translation": "..."}].
- formula: skriv formeln i LaTeX i data.latex och läsbart i text.
- table: rader i data.rows som en lista av listor med celltext.
- diagram, map, image: beskriv exakt vad som visas (etiketter, pilar, värden) i text.
- handwriting: transkribera handskriven text; använd confidence "low" när du är osäker.
- confidence: hur säker du är på läsningen av just det segmentet.
Hoppa över sidnummer, sidhuvuden och dekor. En tom sida ger en tom lista.`

const UNDERSTAND_SYSTEM = `Du sammanfattar studiematerial för en svensk skolelev. Du får materialets segment.
- language: materialets huvudspråk som ISO 639-1-kod (t.ex. "sv", "en").
- subjectCode: ett av de givna ämneskoderna, eller null om inget passar.
- topic: kort ämnesrubrik. summary: en saklig sammanfattning på svenska av vad materialet lär ut.
- concepts: de viktigaste begreppen och färdigheterna, korta.
- curriculumRefs: index (siffror) för de kandidater ur kursplanen som materialet tydligt täcker. Välj bara bland kandidaterna; hellre inga än fel.
Använd bara det som står i materialet.`

/** Normalized page image (EXIF-rotated, long edge ≤ 2000 px). PDF pages come from poppler. */
async function pageImage(dir: string, p: PageRow, signal: AbortSignal) {
  const src = join(dir, p.file)
  const sharp = (await import('sharp')).default
  if (p.pdfPage) {
    const n = String(p.pdfPage)
    const args = ['-f', n, '-l', n, '-scale-to', String(MAX_SIDE), '-png', '-singlefile', src]
    const { stdout } = await run('pdftoppm', args, {
      encoding: 'buffer',
      maxBuffer: 256 << 20,
      timeout: 120_000,
      signal,
    })
    const data = await sharp(stdout).png({ compressionLevel: 9 }).toBuffer()
    return { data, mimeType: 'image/png' }
  }
  const data = await sharp(await readFile(src))
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer()
  return { data, mimeType: 'image/jpeg' }
}

async function textLayer(dir: string, p: PageRow, signal: AbortSignal): Promise<string> {
  if (!p.pdfPage) return ''
  const n = String(p.pdfPage)
  const { stdout } = await run('pdftotext', ['-layout', '-f', n, '-l', n, join(dir, p.file), '-'], {
    maxBuffer: 16 << 20,
    timeout: 60_000,
    signal,
  })
  return stdout.trim()
}

const usable = (t: string) => t.replace(/\s/g, '').length >= MIN_TEXT_LAYER_CHARS

/** Text-layer-only extraction: paragraphs become text segments. */
const fromTextLayer = (t: string): Extracted =>
  t
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => s.match(/[\s\S]{1,8000}/g) ?? [])
    .map((text) => ({ kind: 'text' as const, text, confidence: 'high' as const }))

export async function processSet(
  deps: HandlerDeps,
  setId: string,
  tools: Pick<JobTools, 'signal' | 'progress' | 'fail'>,
) {
  const { db, ai, log } = deps
  const { signal, progress } = tools
  const t0 = performance.now()
  const [set] = await db
    .update(studySets)
    .set({ status: 'processing', failure: null, failedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(studySets.id, setId),
        inArray(studySets.status, ['queued', 'processing', 'failed']),
        isNull(studySets.sourcesDeletedAt),
      ),
    )
    .returning()
  if (!set) {
    const [cur] = await db.select({ status: studySets.status }).from(studySets).where(eq(studySets.id, setId))
    if (cur?.status === 'ready') return setId
    tools.fail('upload_gone', 'Originalfilerna finns inte kvar. Ladda upp materialet igen.', false)
  }
  const [learner] = await db.select().from(learners).where(eq(learners.id, set.learnerId))
  const pages = await db.select().from(studyPages).where(eq(studyPages.setId, setId)).orderBy(asc(studyPages.page))
  if (!learner || !pages.length) tools.fail('upload_unreadable', 'Materialet saknar sidor.', false)
  if (!ai.text) tools.fail('ai_unavailable', 'AI-textgenerering är inte konfigurerad.', false)
  const dir = uploadDir(deps.env.DATA_DIR, setId)

  // Text-only path: no vision, but every page is a PDF page with a usable text layer.
  let layers: string[] | undefined
  if (!ai.vision) {
    layers = pages.every((p) => p.pdfPage) ? await Promise.all(pages.map((p) => textLayer(dir, p, signal))) : []
    if (layers.length !== pages.length || !layers.every(usable))
      tools.fail('ai_unavailable', 'Bildtolkning (AI-vision) är inte konfigurerad.', false)
  }

  const segments: StudySegment[] = []
  let cachedPages = 0
  let visionModel: string | undefined
  for (const [i, p] of pages.entries()) {
    await progress((0.8 * i) / pages.length, `Läser sida ${i + 1} av ${pages.length}`)
    let extracted: Extracted
    if (layers) extracted = fromTextLayer(layers[i]!)
    else {
      const key = and(eq(studyPageExtractions.sha256, p.sha256), eq(studyPageExtractions.pdfPage, p.pdfPage ?? 0))
      const [hit] = await db.select().from(studyPageExtractions).where(key)
      if (hit) {
        cachedPages++
        extracted = hit.segments
        visionModel ??= hit.model
      } else {
        const hint = (await textLayer(dir, p, signal)).slice(0, 6000)
        const image = await pageImage(dir, p, signal).catch(() =>
          tools.fail('upload_unreadable', `Sida ${i + 1} gick inte att läsa som bild.`, false),
        )
        const r = await ai.vision!.generate({
          system: VISION_SYSTEM,
          messages: [
            {
              role: 'user',
              content: hint
                ? `Läs sidan. PDF:ens textlager (kan vara ofullständigt, använd som stöd):\n${hint}`
                : 'Läs sidan.',
            },
          ],
          images: [image],
          schema: PageExtraction,
          schemaName: 'page_segments',
          signal,
        })
        extracted = r.output.segments
        visionModel ??= r.model
        await db
          .insert(studyPageExtractions)
          .values({ sha256: p.sha256, pdfPage: p.pdfPage ?? 0, segments: extracted, model: r.model })
          .onConflictDoNothing()
      }
    }
    extracted.forEach((s, n) => segments.push({ ...s, id: `p${p.page}s${n + 1}`, page: p.page }))
  }
  if (!segments.length) tools.fail('upload_unreadable', 'Inget innehåll kunde läsas från sidorna.', false)

  await progress(0.85, 'Sammanfattar materialet')
  const position = learner.profile.school
  let body = ''
  for (const s of segments) {
    const line = `[${s.id} ${s.kind}] ${s.text}\n`
    if (body.length + line.length > MAX_UNDERSTAND_CHARS) break
    body += line
  }
  const subjects = await subjectsFor(db, position).catch(() => [])
  const candidates = await suggestRefs(db, { position, text: body.slice(0, 20_000), limit: 15 }).catch(() => [])
  const Understanding = z.object({
    language: z.string().min(2).max(5),
    subjectCode: z.string().nullable(),
    topic: z.string().min(1).max(200),
    summary: z.string().min(1).max(2000),
    concepts: z.array(z.string().min(1).max(120)).max(60),
    curriculumRefs: z.array(z.number().int().min(0)).max(20),
  })
  const u = await ai.text!.generate({
    system: UNDERSTAND_SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `Ämneskoder: ${subjects.map((s) => `${s.code} (${s.name})`).join(', ') || 'inga'}\n\n` +
          `Kandidater ur kursplanen:\n${candidates.map((c, n) => `${n}: ${c.subjectName} – ${c.text}`).join('\n') || 'inga'}\n\n` +
          `Segment:\n${body}`,
      },
    ],
    schema: Understanding,
    schemaName: 'study_material',
    signal,
  })
  const refs = []
  for (const n of new Set(u.output.curriculumRefs)) {
    const ref = candidates[n]?.ref
    if (ref && (await isValidRef(db, ref))) refs.push(ref)
  }
  const subjectGuess = subjects.some((s) => s.code === u.output.subjectCode) ? u.output.subjectCode! : undefined
  const parsed = ProcessedStudyMaterial.safeParse({
    studySetId: setId,
    language: u.output.language,
    subjectGuess,
    topic: u.output.topic,
    summary: u.output.summary,
    concepts: u.output.concepts,
    curriculumRefs: refs,
    segments,
    processedAt: new Date().toISOString(),
  })
  if (!parsed.success) tools.fail('ai_invalid_output', 'AI-svaret gick inte att tolka. Försök igen.', false)
  const m = parsed.data

  await progress(0.95, 'Sparar materialet')
  await db.transaction(async (tx) => {
    const [ok] = await tx
      .update(studySets)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(and(eq(studySets.id, setId), eq(studySets.status, 'processing')))
      .returning({ id: studySets.id })
    if (!ok) throw new JobFailure('cancelled', 'Materialet togs bort under bearbetningen.', false)
    await tx.delete(studySegments).where(eq(studySegments.setId, setId))
    await tx.delete(studyMaterials).where(eq(studyMaterials.setId, setId))
    await tx.insert(studyMaterials).values({
      setId,
      language: m.language,
      subjectGuess: m.subjectGuess,
      topic: m.topic,
      summary: m.summary,
      concepts: m.concepts,
      curriculumRefs: m.curriculumRefs,
      processedAt: new Date(m.processedAt),
      provenance: {
        method: layers ? 'text-layer' : 'vision',
        ...(visionModel ? { visionModel } : {}),
        textModel: u.model,
        pages: pages.length,
        cachedPages,
      },
    })
    await tx.insert(studySegments).values(m.segments.map((s, ord) => ({ ...s, setId, ord, data: s.data ?? null })))
  })
  await deleteOriginalsAfterCommit(db, deps.env.DATA_DIR, setId)
  log.info(
    {
      studySetId: setId,
      pages: pages.length,
      cachedPages,
      segments: segments.length,
      durationMs: Math.round(performance.now() - t0),
    },
    'study set processed',
  )
  return setId
}

/** Committed → originals are no longer needed. If removal fails, uploads.cleanup retries it. */
async function deleteOriginalsAfterCommit(db: Db, dataDir: string, setId: string) {
  await removeOriginals(dataDir, setId)
  await db.update(studyPages).set({ sourceDeleted: true }).where(eq(studyPages.setId, setId))
  await db.update(studySets).set({ sourcesDeletedAt: new Date() }).where(eq(studySets.id, setId))
}

export function studyHandlers(deps: HandlerDeps): JobHandler[] {
  return [
    defineJobHandler('study.process', async (job, tools) => {
      const setId = z.string().uuid().parse(job.payload.setId)
      try {
        return await processSet(deps, setId, tools)
      } catch (e) {
        const reason = tools.signal.aborted ? tools.signal.reason : undefined
        const failure =
          e instanceof JobFailure
            ? e.jobError
            : e instanceof AiError
              ? { code: e.code, adultMessage: e.message, retryable: e.retryable }
              : {
                  code: reason === 'cancelled' ? 'cancelled' : 'internal',
                  adultMessage: 'Bearbetningen avbröts.',
                  retryable: false,
                }
        const requeued = reason === 'shutdown' || (!reason && failure.retryable && job.attempts < job.maxAttempts)
        await deps.db
          .update(studySets)
          .set(
            requeued
              ? { status: 'queued', updatedAt: new Date() }
              : { status: 'failed', failure: failure.adultMessage, failedAt: new Date(), updatedAt: new Date() },
          )
          .where(and(eq(studySets.id, setId), eq(studySets.status, 'processing')))
        deps.log.warn({ studySetId: setId, code: failure.code, requeued }, 'study set processing failed')
        if (e instanceof AiError) tools.fail(e.code, e.message, e.retryable)
        throw e
      }
    }),
    defineJobHandler('uploads.cleanup', async () => {
      await cleanupUploads(deps.db, deps.env.DATA_DIR, parseEnv(LimitsEnv).UPLOAD_FAILED_RETENTION_HOURS)
    }),
  ]
}

/**
 * Failed-set originals past retention, stale sets, orphaned dirs. Never touches files of a set
 * that is uploading, queued or processing: purges claim `status = 'failed'` rows atomically.
 */
export async function cleanupUploads(db: Db, dataDir: string, retentionHours: number, now = new Date()) {
  const hourAgo = new Date(now.getTime() - HOUR)
  // Sets whose job is gone (worker lost with attempts used up, timeout) → failed; retention starts now.
  await db
    .update(studySets)
    .set({ status: 'failed', failure: 'Bearbetningen avbröts.', failedAt: now, updatedAt: now })
    .where(
      and(
        inArray(studySets.status, ['queued', 'processing']),
        lt(studySets.updatedAt, hourAgo),
        sql`not exists (select 1 from ${jobs} where ${jobs.dedupeKey} = 'study.process:' || ${studySets.id}
          and ${jobs.state} in ('queued', 'processing'))`,
      ),
    )
  // Interrupted uploads (app restarted mid-request).
  const dead = await db
    .delete(studySets)
    .where(and(eq(studySets.status, 'uploading'), lt(studySets.createdAt, hourAgo)))
    .returning({ id: studySets.id })
  for (const s of dead) await removeOriginals(dataDir, s.id)

  const purged = await db
    .update(studySets)
    .set({ sourcesDeletedAt: now })
    .where(
      and(
        eq(studySets.status, 'failed'),
        isNull(studySets.sourcesDeletedAt),
        lt(studySets.failedAt, new Date(now.getTime() - retentionHours * HOUR)),
      ),
    )
    .returning({ id: studySets.id })
  for (const s of purged) {
    await removeOriginals(dataDir, s.id)
    await db.update(studyPages).set({ sourceDeleted: true }).where(eq(studyPages.setId, s.id))
  }

  // Orphans: no set row (after a grace hour), or originals already released (ready/purged).
  const names = await readdir(uploadDir(dataDir)).catch(() => [] as string[])
  const ids = names.filter((n) => z.string().uuid().safeParse(n).success)
  const rows = ids.length ? await db.select().from(studySets).where(inArray(studySets.id, ids)) : []
  const byId = new Map(rows.map((r) => [r.id, r]))
  let orphans = 0
  for (const name of names) {
    const row = byId.get(name)
    if (row?.status === 'ready' && !row.sourcesDeletedAt) {
      await deleteOriginalsAfterCommit(db, dataDir, row.id)
      orphans++
    } else if (row ? !!row.sourcesDeletedAt : (await stat(join(uploadDir(dataDir), name))).mtime < hourAgo) {
      await removeOriginals(dataDir, name)
      orphans++
    }
  }
  return { purged: purged.length, interrupted: dead.length, orphans }
}
