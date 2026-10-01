import { eq, lt, sql } from 'drizzle-orm'
import type { Artifact, AssetLicense, MediaRef } from '../../shared/contracts'
import { AiError, parseAiConfig, type AiServices } from '../ai'
import { storeAsset } from '../assets/store'
import { parseEnv } from '../config/env'
import { FeaturesEnv } from '../config/features'
import { LimitsEnv } from '../config/limits'
import type { Db } from '../db/client'
import { imageGenerationDays } from '../db/schema'
import { defineJobHandler, registerJobPayload, type EnqueueInput, type JobHandler } from '../jobs'
import { altText, buildImagePrompt, ImageJobPayload, screenRequest, type ImagePurpose, type ImageStyle } from './prompt'

// AI illustrations (docs/platform/images.md): the image.generate job, daily cap, artifact media slots.

export * from './prompt'

export const IMAGE_SIZE = '1024x1024'

registerJobPayload('image.generate', ImageJobPayload)

export function imageSettings(env: NodeJS.ProcessEnv = process.env) {
  return {
    enabled: parseEnv(FeaturesEnv, env).FEATURE_IMAGE_GENERATION,
    cap: parseEnv(LimitsEnv, env).LIMIT_IMAGES_PER_DAY,
  }
}

type Refusal = { code: string; message: string }

/** Why image generation can't run at all (flag off or no IMAGE capability), with Swedish adult text. */
export function imageUnavailable(
  ai: AiServices | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Refusal | undefined {
  if (!imageSettings(env).enabled)
    return { code: 'feature_disabled', message: 'Bildgenerering är avstängd (FEATURE_IMAGE_GENERATION=false).' }
  if (!ai?.image)
    return { code: 'capability_missing', message: 'Bildgenerering är inte konfigurerad (AI_IMAGE_PROVIDER saknas).' }
  return undefined
}

const LIMIT_MESSAGE = 'Dagens gräns för AI-bilder är nådd (LIMIT_IMAGES_PER_DAY). Försök igen i morgon.'

/** Images generated today (DB clock). */
export async function imagesToday(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: imageGenerationDays.count })
    .from(imageGenerationDays)
    .where(eq(imageGenerationDays.day, sql`current_date`))
  return row?.count ?? 0
}

/** Atomically count one image for today unless the cap is reached. False = over the cap. */
export async function reserveImage(db: Db, cap: number): Promise<boolean> {
  const rows = await db
    .insert(imageGenerationDays)
    .values({ day: sql`current_date`, count: 1 })
    .onConflictDoUpdate({
      target: imageGenerationDays.day,
      set: { count: sql`${imageGenerationDays.count} + 1` },
      setWhere: lt(imageGenerationDays.count, cap),
    })
    .returning({ count: imageGenerationDays.count })
  return rows.length > 0
}

/** Adult status: today's count, the cap and whether generation is usable, with a Swedish label. */
export async function imageStatus(db: Db, ai: AiServices | undefined, env: NodeJS.ProcessEnv = process.env) {
  const { cap } = imageSettings(env)
  const today = await imagesToday(db)
  const off = imageUnavailable(ai, env)
  return {
    enabled: !off,
    today,
    cap,
    remaining: Math.max(0, cap - today),
    reason: off?.code,
    label: off?.message ?? (today >= cap ? LIMIT_MESSAGE : `${today} av ${cap} AI-bilder använda i dag.`),
  }
}

export function generatedLicense(provider: string, model?: string): AssetLicense {
  return {
    license: 'ai-generated',
    provider,
    creator: model ? `AI (${model})`.slice(0, 200) : undefined,
    retrievedAt: new Date().toISOString(),
    autoUsable: true,
  }
}

export interface ImageJobDeps {
  ai?: AiServices
  dataDir: string
  /** Raw env for FEATURE_/LIMIT_/AI_IMAGE_PROVIDER (default process.env). */
  env?: NodeJS.ProcessEnv
}

/** The `image.generate` worker handler. Returns the stored asset id. */
export function imageJobHandler(deps: ImageJobDeps): JobHandler {
  const env = deps.env ?? process.env
  return defineJobHandler('image.generate', async (job, { db, signal, progress, fail }) => {
    // Also validated at enqueue (registerJobPayload); parsed again as defence in depth.
    const parsed = ImageJobPayload.safeParse(job.payload)
    if (!parsed.success) return fail('invalid_payload', 'Bildförfrågan är ogiltig.', false)
    const p = parsed.data
    const blocked = imageUnavailable(deps.ai, env) ?? screenRequest(p)
    if (blocked) return fail(blocked.code, blocked.message, false)
    // ponytail: a reserved slot is kept even if the provider then fails; refund if caps get tight.
    if (!(await reserveImage(db, imageSettings(env).cap))) return fail('limit_exceeded', LIMIT_MESSAGE, false)

    await progress(0.2, 'Ritar bilden')
    let result
    try {
      result = await deps.ai!.image!.generate({ prompt: buildImagePrompt(p), size: IMAGE_SIZE, n: 1, signal })
    } catch (e) {
      if (e instanceof AiError) return fail(e.code, e.message, e.retryable, e.retryAfterMs)
      throw e
    }
    const img = result.images[0]
    if (!img) return fail('ai_invalid_output', 'AI-tjänsten returnerade ingen bild.', false)

    await progress(0.9, 'Sparar bilden')
    const provider = parseAiConfig(env).image?.provider ?? 'image'
    const row = await storeAsset(db, deps.dataDir, {
      data: img.data,
      mimeType: img.mimeType,
      alt: altText(p),
      generated: true,
      license: generatedLicense(provider, result.model),
    }).catch(() => fail('asset_unsupported', 'Bilden kunde inte sparas (okänt bildformat).', false))
    return row.id
  })
}

// ---- Artifact integration ----

export interface IllustrationSlot {
  artifactId: string
  /** MediaPath: "sections.0", "sections.0.items.2", "sections.0.items.2.choices.1". */
  path: string
  description: string
  purpose: ImagePurpose
  count?: number
  /** The item the slot belongs to (generation's illustration requests). */
  itemId?: string
}

export interface IllustrationOptions {
  enqueue: (input: EnqueueInput) => Promise<{ id: string }>
  style: ImageStyle
  subject?: string
  learnerId?: string
}

/**
 * Enqueue one image.generate job per slot (deduped per artifact path). Slots that need real
 * imagery are not enqueued: `refused: 'factual_reference'` → use findLicensedImages instead.
 */
export async function illustrationJobsFor(slots: IllustrationSlot[], opts: IllustrationOptions) {
  const out: { slot: IllustrationSlot; jobId?: string; refused?: string }[] = []
  for (const slot of slots) {
    const subject = opts.subject ?? ''
    const refusal = screenRequest({ description: slot.description, subject })
    if (refusal) {
      out.push({ slot, refused: refusal.code })
      continue
    }
    const { id } = await opts.enqueue({
      type: 'image.generate',
      learnerId: opts.learnerId,
      dedupeKey: `image:${slot.artifactId}:${slot.path}`,
      payload: {
        purpose: slot.purpose,
        subject,
        description: slot.description,
        style: opts.style,
        count: slot.count,
        learnerId: opts.learnerId,
        artifactId: slot.artifactId,
        target: { path: slot.path, itemId: slot.itemId },
      },
    })
    out.push({ slot, jobId: id })
  }
  return out
}

const PATH = /^sections\.(\d+)(?:\.items\.(\d+)(?:\.(?:choices|items)\.(\d+))?)?$/
const MAX_SECTION_MEDIA = 6
const MAX_ITEM_MEDIA = 4

/**
 * Pure: a copy of `artifact` with each MediaRef inserted at its path (sections/items append up to
 * their max, choices are set). Paths that no longer exist, full slots and duplicate assets are skipped.
 */
export function applyGeneratedMedia(artifact: Artifact, results: { path: string; media: MediaRef }[]): Artifact {
  const next = structuredClone(artifact)
  for (const { path, media } of results) {
    const m = PATH.exec(path)
    const section = m && next.sections[Number(m[1])]
    if (!section) continue
    if (m[2] === undefined) {
      if (section.media.length < MAX_SECTION_MEDIA && !section.media.some((r) => r.assetId === media.assetId))
        section.media.push(media)
      continue
    }
    const item = section.items[Number(m[2])]
    if (!item) continue
    if (m[3] === undefined) {
      if (item.media.length < MAX_ITEM_MEDIA && !item.media.some((r) => r.assetId === media.assetId))
        item.media.push(media)
      continue
    }
    const list = 'choices' in item ? item.choices : item.kind === 'ordering' ? item.items : undefined
    const choice = list?.[Number(m[3])]
    if (choice) choice.media = media
  }
  return next
}
