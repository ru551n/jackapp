import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  GenerationRequest,
  type ApprovalState,
  type Artifact,
  type GenerationPolicy,
  type LearnerProfileInput,
  type ValidationReport,
} from '../../shared/contracts'
import { AiError, type AiServices } from '../ai'
import { subjectsFor } from '../curriculum/service'
import type { Db } from '../db/client'
import { learners, studySets } from '../db/schema'
import { defineJobHandler, registerJobPayload, type JobHandler, type JobTools } from '../jobs'
import {
  defaultMaterialLoader,
  generateArtifact,
  regenerateItem,
  type EngineDeps,
  type MaterialLoader,
  type Prepared,
} from './engine'
import { describeItem } from './items'
import { PROMPT_VERSION, TRANSFORM_SV, transformContext, type TransformKind } from './prompts'
import { interpretInstructions, resolveRequest, scrubRequest, type ResolvedRequest } from './request'
import { loadBrief, researchBrief, type BriefResult, type ResearchOptions } from '../research/brief'
import { enqueueIllustrations } from './media'
import { addVersion, approvalFor, createArtifact, loadArtifact, type StoredArtifact } from './store'

// Job payloads and handlers: artifact.generate (new + transforms) and artifact.regenerateItem.

export const TransformKindSchema = z.enum(Object.keys(TRANSFORM_SV) as [TransformKind, ...TransformKind[]])

export const GeneratePayload = z.union([
  z.object({
    request: GenerationRequest,
    /** Keys the caller sent explicitly; they win over interpreted instructions. */
    explicit: z.array(z.string()).default([]),
    createdBy: z.enum(['adult', 'learner', 'system']),
  }),
  z.object({
    transform: z.object({
      artifactId: z.string().uuid(),
      kind: TransformKindSchema,
      theme: z.string().max(100).optional(),
    }),
    createdBy: z.enum(['adult', 'learner', 'system']),
  }),
])
export type GeneratePayload = z.infer<typeof GeneratePayload>
export const RegenerateItemPayload = z.object({ artifactId: z.string().uuid(), itemId: z.string().max(60) })

registerJobPayload('artifact.generate', GeneratePayload)
registerJobPayload('artifact.regenerateItem', RegenerateItemPayload)
// Handlers parse again (defence in depth: rows may predate a schema change).

export interface GenerationDeps {
  /** `text` is required; `research` enables useWebResearch. */
  ai: Pick<AiServices, 'text'> & Partial<AiServices>
  /** Wire to server/study/material.ts `loadProcessedMaterial` (never re-runs vision). */
  loadMaterial?: MaterialLoader
  validate?: EngineDeps['validate']
  /** Server-only metadata stored on versions, e.g. parseAiConfig(env).text?.provider. */
  providerKind?: string
  /** Web research options (tests inject a fetcher and env). */
  research?: Omit<ResearchOptions, 'signal'>
}

/** After a change to an existing artifact: invalid → draft; a draft that became valid follows the policy. */
export function nextApproval(current: ApprovalState, ok: boolean, policy: GenerationPolicy['approval']): ApprovalState {
  if (!ok) return 'draft'
  return current === 'draft' ? approvalFor(policy, true) : current
}

const firstError = (r: ValidationReport) => r.issues.find((i) => i.severity === 'error')?.message ?? 'okänt fel'

export function validationFailedMessage(a: Artifact, stored: boolean) {
  const n = a.validation.issues.filter((i) => i.severity === 'error').length
  return (
    `Materialet "${a.title}" klarade inte kvalitetskontrollen (${n} fel, t.ex. "${firstError(a.validation)}").` +
    (stored ? ' Det sparades som utkast så att du kan granska och rätta det.' : ' Ingen ny version sparades.')
  )
}

async function profileOf(db: Db, learnerId: string, tools: JobTools): Promise<LearnerProfileInput> {
  const [l] = await db.select().from(learners).where(eq(learners.id, learnerId))
  if (!l) tools.fail('not_found', 'Eleven finns inte längre.', false)
  return l.profile
}

async function material(deps: GenerationDeps, db: Db, r: ResolvedRequest, tools: JobTools) {
  if (!r.studySetId) return undefined
  const m = await (deps.loadMaterial ?? defaultMaterialLoader)(db, r.studySetId)
  if (m) return m
  // Only a set that is still being processed is worth retrying for.
  const [set] = await db.select({ status: studySets.status }).from(studySets).where(eq(studySets.id, r.studySetId))
  if (!set) tools.fail('not_found', 'Studiematerialet finns inte längre.', false)
  if (set.status === 'failed')
    tools.fail('material_failed', 'Studiematerialet kunde inte bearbetas. Försök bearbeta det igen först.', false)
  tools.fail('material_unavailable', 'Studiematerialet är inte färdigbehandlat ännu.', true)
}

/**
 * Web research for `useWebResearch` (not in strict mode). Null when the feature is off or not
 * configured; any research failure only means generating without it.
 */
async function research(deps: GenerationDeps, r: ResolvedRequest, m: Material, tools: JobTools) {
  if (!r.useWebResearch || r.sourceMode === 'strict') return undefined
  const topic = (r.topic ?? m?.topic ?? r.instructions)?.slice(0, 200)
  if (!topic || topic.trim().length < 2) return undefined
  await tools.progress(0.08, 'Söker på webben')
  try {
    return (
      (await researchBrief(
        tools.db,
        deps.ai as AiServices,
        { topic, school: r.school },
        { ...deps.research, signal: tools.signal },
      )) ?? undefined
    )
  } catch (e) {
    if (tools.signal.aborted) throw e
    tools.log.warn({ err: { name: (e as Error).name } }, 'web research failed; generating without it')
    return undefined
  }
}

/** Stored brief of an earlier generation (transforms and item regeneration never search again). */
const storedResearch = (db: Db, r: ResolvedRequest): Promise<BriefResult | undefined> =>
  r.researchBriefId ? loadBrief(db, r.researchBriefId) : Promise.resolve(undefined)

type Material = Awaited<ReturnType<typeof material>>

/** Transforms adjust the stored resolved request; no re-interpretation and no vision. */
export function applyTransform(r: ResolvedRequest, kind: TransformKind, theme?: string): ResolvedRequest {
  const out: ResolvedRequest = { ...r, support: { ...r.support }, instructions: undefined }
  const count = (n: number) => Math.min(60, Math.max(1, n))
  switch (kind) {
    case 'harder':
      out.difficulty = Math.min(5, r.difficulty + 1)
      break
    case 'easier':
      out.difficulty = Math.max(1, r.difficulty - 1)
      break
    case 'simplify':
      out.support.textAmount = r.support.textAmount === 'normal' ? 'reduced' : 'minimal'
      break
    case 'moreVisual':
      out.support.visualSupport = 'high'
      out.includeImages = true
      break
    case 'changeTheme':
      out.theme = theme
      break
    case 'shorten':
      out.questionCount = count(Math.round(r.questionCount * 0.6))
      break
    case 'expand':
      out.questionCount = count(Math.round(r.questionCount * 1.5))
      break
    case 'more':
      break
  }
  return out
}

/** Compact previous version for transform prompts (no ids, sources or media). */
function previousVersion(a: Artifact): string {
  return JSON.stringify(
    a.sections.map((s) => ({ kind: s.kind, title: s.title, body: s.body, items: s.items.map(describeItem) })),
  ).slice(0, 10_000)
}

async function aiGuard<T>(tools: JobTools, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof AiError) tools.fail(e.code, e.message, e.retryable)
    throw e
  }
}

export function generationJobHandlers(deps: GenerationDeps): JobHandler[] {
  const engine = (tools: JobTools): EngineDeps => {
    if (!deps.ai.text) tools.fail('ai_unavailable', 'AI-textgenerering är inte konfigurerad.', false)
    return { db: tools.db, text: deps.ai.text, validate: deps.validate, signal: tools.signal, progress: tools.progress }
  }
  const meta = (origin: string, model?: string) => ({
    origin,
    model,
    providerKind: deps.providerKind,
    promptVersion: PROMPT_VERSION,
  })

  const generate = defineJobHandler('artifact.generate', async (job, tools) => {
    const payload = GeneratePayload.parse(job.payload)
    const eng = engine(tools)
    return aiGuard(tools, async () => {
      if ('transform' in payload) return transform(eng, payload.transform, tools)
      const { explicit, createdBy } = payload
      const profile = await profileOf(tools.db, payload.request.learnerId, tools)
      const request = scrubRequest(payload.request, profile.displayName)
      let interpreted = {}
      if (request.instructions) {
        await tools.progress(0.05, 'Tolkar önskemålet')
        const subjects = await subjectsFor(tools.db, request.school ?? profile.school).catch(() => [])
        interpreted = await interpretInstructions(eng.text, request.instructions, subjects, tools.signal)
      }
      const resolved = resolveRequest(request, explicit, interpreted, profile)
      const m = await material(deps, tools.db, resolved, tools)
      const web = await research(deps, resolved, m, tools)
      if (web) resolved.researchBriefId = web.briefId
      const g = await generateArtifact(
        eng,
        { request: resolved, profile, material: m, research: web },
        { id: crypto.randomUUID(), learnerId: request.learnerId, createdBy, version: 1 },
      )
      const a = { ...g.artifact, approval: approvalFor(profile.generation.approval, g.ok) }
      await createArtifact(tools.db, a, resolved, {
        ...meta('generate', g.model),
        illustrations: g.illustrations,
        jobId: job.id,
      })
      if (!g.ok) tools.fail('validation_failed', validationFailedMessage(a, true), false)
      await enqueueIllustrations(
        tools.db,
        deps.ai,
        { artifact: a, illustrations: g.illustrations },
        resolved,
        profile,
        tools.log,
      )
      return a.id
    })
  })

  async function transform(
    eng: EngineDeps,
    t: { artifactId: string; kind: TransformKind; theme?: string },
    tools: JobTools,
  ): Promise<string> {
    const stored = await loadOrFail(tools, t.artifactId)
    const profile = await profileOf(tools.db, stored.row.learnerId, tools)
    const request = applyTransform(stored.row.request as ResolvedRequest, t.kind, t.theme)
    const m = await material(deps, tools.db, request, tools)
    const prev = stored.artifact
    const p: Prepared = {
      request,
      profile,
      material: m,
      research: await storedResearch(tools.db, request),
      extraContext: transformContext(t.kind, previousVersion(prev)),
    }
    if (t.kind === 'more') p.avoid = prev.sections.flatMap((s) => s.items.map((i) => i.prompt.slice(0, 120)))
    const isNew = t.kind === 'more'
    const g = await generateArtifact(eng, p, {
      id: isNew ? crypto.randomUUID() : prev.id,
      learnerId: prev.learnerId,
      createdBy: prev.createdBy,
      version: prev.version,
    })
    const policy = profile.generation.approval
    if (isNew) {
      const a = { ...g.artifact, approval: approvalFor(policy, g.ok) }
      await createArtifact(tools.db, a, request, { ...meta('transform:more', g.model), illustrations: g.illustrations })
      if (!g.ok) tools.fail('validation_failed', validationFailedMessage(a, true), false)
      await enqueueIllustrations(
        tools.db,
        deps.ai,
        { artifact: a, illustrations: g.illustrations },
        request,
        profile,
        tools.log,
      )
      return a.id
    }
    const keep = prev.approval === 'draft'
    const a = { ...g.artifact, createdAt: prev.createdAt, approval: nextApproval(prev.approval, g.ok, policy) }
    if (!g.ok && !keep) tools.fail('validation_failed', validationFailedMessage(a, false), false)
    const saved = await addVersion(
      tools.db,
      a,
      { ...meta(`transform:${t.kind}`, g.model), illustrations: g.illustrations },
      request,
    )
    if (!g.ok) tools.fail('validation_failed', validationFailedMessage(a, true), false)
    await enqueueIllustrations(
      tools.db,
      deps.ai,
      { artifact: saved!, illustrations: g.illustrations },
      request,
      profile,
      tools.log,
    )
    return a.id
  }

  const regenerate = defineJobHandler('artifact.regenerateItem', async (job, tools) => {
    const { artifactId, itemId } = RegenerateItemPayload.parse(job.payload)
    const eng = engine(tools)
    return aiGuard(tools, async () => {
      const stored = await loadOrFail(tools, artifactId)
      const profile = await profileOf(tools.db, stored.row.learnerId, tools)
      const request = stored.row.request as ResolvedRequest
      const m = await material(deps, tools.db, request, tools)
      const research = await storedResearch(tools.db, request)
      const r = await regenerateItem(eng, { request, profile, material: m, research }, stored.artifact, itemId)
      const prev = stored.artifact
      const a = { ...r.artifact, approval: nextApproval(prev.approval, r.ok, profile.generation.approval) }
      if (!r.ok && prev.approval !== 'draft') tools.fail('validation_failed', validationFailedMessage(a, false), false)
      const illustrations = [...stored.illustrations.filter((i) => i.itemId !== itemId)]
      if (r.illustration) illustrations.push(r.illustration)
      const saved = await addVersion(tools.db, a, { ...meta('regenerateItem', r.model), illustrations })
      if (!r.ok) tools.fail('validation_failed', validationFailedMessage(a, true), false)
      // Only the new item's illustration: the others already had their chance.
      const mine = illustrations.filter((i) => i.itemId === itemId)
      await enqueueIllustrations(
        tools.db,
        deps.ai,
        { artifact: saved!, illustrations: mine },
        request,
        profile,
        tools.log,
      )
      return a.id
    })
  })

  return [generate, regenerate]
}

async function loadOrFail(tools: JobTools, id: string): Promise<StoredArtifact> {
  const s = await loadArtifact(tools.db, id)
  if (!s) tools.fail('not_found', 'Materialet finns inte längre.', false)
  return s
}
