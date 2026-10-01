import { eq } from 'drizzle-orm'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { ageBand, type Artifact, type LearnerProfileInput } from '../../shared/contracts'
import type { AiServices } from '../ai'
import { toMediaRef } from '../assets/store'
import { subject } from '../curriculum/service'
import type { Db } from '../db/client'
import { assets } from '../db/schema'
import { applyGeneratedMedia, illustrationJobsFor, imageUnavailable, MediaTarget, screenRequest } from '../images'
import { enqueue, type JobHandler } from '../jobs'
import { externalAssetsEnabled } from '../research/assets'
import { defaultMaterialLoader, revalidate } from './engine'
import type { ResolvedRequest } from './request'
import { addVersion, loadArtifact, type StoredArtifact } from './store'
import { requestedIllustrations } from './view'

// Generation ↔ images (docs/platform/generation.md#illustrations):
// 1. enqueueIllustrations: after a version is stored, one image.generate job per illustration
//    request (or asset.fetch for slots that need real imagery).
// 2. applyJobMedia: the worker's completion hook for those jobs; adds the media as a new version.

/** ponytail: per-version cap so one big test can't spend the daily image budget; raise if needed. */
export const MAX_ILLUSTRATIONS = 12

type Log = { warn(o: object, msg: string): void }

/** Image payloads cap descriptions at 280 chars; compare requests in that form. */
const clipDescription = (d: string) => d.trim().slice(0, 280)

const pathOf = (a: Artifact, itemId: string) => {
  for (const [s, sec] of a.sections.entries()) {
    const i = sec.items.findIndex((x) => x.id === itemId)
    if (i >= 0) return `sections.${s}.items.${i}`
  }
  return undefined
}

/**
 * Enqueue media jobs for the stored version's open illustration requests when the request asks
 * for images (includeImages, or high visual support). Never throws: images are an extra.
 */
export async function enqueueIllustrations(
  db: Db,
  ai: Partial<AiServices>,
  stored: Pick<StoredArtifact, 'artifact' | 'illustrations'>,
  request: ResolvedRequest,
  profile: LearnerProfileInput,
  log: Log,
): Promise<void> {
  if (!request.includeImages && request.support.visualSupport !== 'high') return
  const a = stored.artifact
  try {
    const subjectName = a.subjectCode ? ((await subject(db, a.subjectCode).catch(() => null))?.name ?? '') : ''
    const slots = requestedIllustrations(stored)
      .slice(0, MAX_ILLUSTRATIONS)
      .flatMap((r) => {
        const path = pathOf(a, r.itemId)
        return path
          ? [
              {
                artifactId: a.id,
                path,
                itemId: r.itemId,
                description: clipDescription(r.description),
                purpose: 'illustration' as const,
              },
            ]
          : []
      })
    const refusal = (d: string) => screenRequest({ description: d, subject: subjectName })?.code
    if (!imageUnavailable(ai as AiServices)) {
      const style = { ageBand: ageBand(a.school), theme: request.theme ?? profile.themes[0] ?? profile.interests[0] }
      const drawable = slots.filter((s) => !refusal(s.description))
      await illustrationJobsFor(drawable, {
        enqueue: (i) => enqueue(db, i),
        style,
        subject: subjectName,
        learnerId: a.learnerId,
      })
    }
    if (!externalAssetsEnabled()) return
    for (const s of slots.filter((x) => refusal(x.description) === 'factual_reference'))
      await enqueue(db, {
        type: 'asset.fetch',
        learnerId: a.learnerId,
        dedupeKey: `asset:${a.id}:${s.path}`,
        payload: {
          query: s.description,
          count: 1,
          preferFactual: true,
          artifactId: a.id,
          target: { path: s.path, itemId: s.itemId },
        },
      })
  } catch (e) {
    log.warn({ err: { name: (e as Error).name }, artifactId: a.id }, 'could not enqueue illustrations')
  }
}

/** What applyJobMedia needs from an image.generate or asset.fetch payload. */
const MediaJob = z.object({
  artifactId: z.string().uuid(),
  target: MediaTarget,
  description: z.string().optional(),
  query: z.string().optional(),
})

/**
 * Completion hook for image.generate / asset.fetch: put the produced asset into the artifact as a
 * new version. Skipped (no version) when the slot is gone: the item was removed, the illustration
 * request changed (a transform), or the media is already there. Concurrent versions are retried.
 */
export const applyJobMedia: NonNullable<JobHandler['onCompleted']> = async (job, resultId, { db, log }) => {
  const p = MediaJob.safeParse(job.payload)
  if (!p.success || !resultId) return
  const { artifactId, target } = p.data
  const description = p.data.description ?? p.data.query
  const [asset] = await db.select().from(assets).where(eq(assets.id, resultId))
  if (!asset) return
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await loadArtifact(db, artifactId)
    if (!stored) return
    const a = stored.artifact
    // Generation slots carry itemId: the request must still stand for that item.
    let path = target.path
    if (target.itemId) {
      const still = stored.illustrations.some(
        (i) => i.itemId === target.itemId && clipDescription(i.description) === description,
      )
      const at = pathOf(a, target.itemId)
      if (!still || !at) return
      path = at
    }
    const next = applyGeneratedMedia(a, [{ path, media: toMediaRef(asset) }])
    if (isDeepStrictEqual(next, a)) return // already applied, or the slot is full
    const request = stored.row.request as ResolvedRequest
    const material = request.studySetId ? await defaultMaterialLoader(db, request.studySetId) : undefined
    const validation = await revalidate({}, next, { request, material })
    if (a.validation.ok && !validation.ok) {
      log.warn({ artifactId, path }, 'media would break validation; not applied')
      return
    }
    const saved = await addVersion(
      db,
      { ...next, validation },
      { origin: 'media', illustrations: stored.illustrations },
      undefined,
      { expectVersion: a.version, keepApproval: true },
    )
    if (saved) return
  }
  log.warn({ artifactId }, 'artifact kept changing; media not applied')
}
