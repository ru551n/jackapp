import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { SourceRef, StudySegment, StudySet } from '../../shared/contracts'
import type { Db } from '../db/client'
import { studyPages, studySets } from '../db/schema'
import { registerJobPayload } from '../jobs'

// Shared by the upload routes and the worker handlers (docs/platform/uploads.md).

registerJobPayload('study.process', z.object({ setId: z.string().uuid() }))

export const run = promisify(execFile)
export const uploadDir = (dataDir: string, setId?: string) => join(dataDir, 'uploads', ...(setId ? [setId] : []))
export const processDedupeKey = (setId: string) => `study.process:${setId}`

export type SniffedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | 'heic' | undefined

/** Real file type from magic bytes; the client's name and mime type are ignored. */
export function sniff(b: Buffer): SniffedType {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (b.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf'
  if (b.toString('latin1', 4, 8) === 'ftyp' && /^(hei[cxms]|hev[cxms]|mif1|msf1)$/.test(b.toString('latin1', 8, 12)))
    return 'heic'
  return undefined
}

/** Page count via poppler's pdfinfo; undefined when the PDF is unreadable (corrupt, encrypted). */
export async function pdfPageCount(file: string): Promise<number | undefined> {
  try {
    const { stdout } = await run('pdfinfo', [file], { timeout: 30_000 })
    const n = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1])
    return n > 0 ? n : undefined
  } catch {
    return undefined
  }
}

export async function toStudySet(db: Db, set: typeof studySets.$inferSelect): Promise<StudySet> {
  const pages = await db.select().from(studyPages).where(eq(studyPages.setId, set.id)).orderBy(asc(studyPages.page))
  return {
    id: set.id,
    learnerId: set.learnerId,
    title: set.title,
    status: set.status,
    pages: pages.map((p) => ({
      page: p.page,
      mimeType: p.mimeType,
      bytes: p.bytes,
      ...(p.pdfPage ? { pdfPage: p.pdfPage } : {}),
      sourceDeleted: p.sourceDeleted,
    })),
    createdAt: set.createdAt.toISOString(),
    ...(set.status === 'failed' && set.failure ? { failure: set.failure } : {}),
  }
}

/** Remove a set's originals directory (missing is fine). */
export const removeOriginals = (dataDir: string, setId: string) =>
  rm(uploadDir(dataDir, setId), { recursive: true, force: true })

/** Provenance for content generated from a segment (for the generation domain). */
export const segmentSource = (studySetId: string, s: StudySegment): SourceRef => ({
  kind: 'upload',
  studySetId,
  page: s.page,
  segmentId: s.id,
  excerpt: s.text.slice(0, 300),
})
