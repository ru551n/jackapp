import { z } from 'zod'
import type {
  CurriculumRef,
  GenerationRequest,
  ProcessedStudyMaterial,
  SchoolPosition,
  SourceMode,
  ValidationIssue,
  ValidationReport,
} from '../../shared/contracts'
import { Artifact as ArtifactSchema, Item as ItemSchema, ageBand } from '../../shared/contracts'
import type { Artifact, Item } from '../../shared/contracts'
import type { TextGeneration } from '../ai/types'
import { isValidRef as dbIsValidRef } from '../curriculum/service'
import type { Db } from '../db/client'
import { ARTIFACT_CHECKS, ITEM_CHECKS, allItems, answerTexts, materialMissing, type CheckContext } from './checks'

export * from './checks'
export { evaluate, approxEqual, promptExpression } from './expr'
export { scanSafety } from './safety'

export interface ValidationContext {
  request: GenerationRequest
  /** Present when the artifact was generated from uploaded material (needed for grounding checks). */
  material?: ProcessedStudyMaterial
  /** Curriculum ref validator. Defaults to the real `isValidRef` when `db` is given; else the check is skipped. */
  isValidRef?: (ref: CurriculumRef) => Promise<boolean>
  db?: Db
  /** Opt-in AI review: a secondary signal (warnings only), never an approval. */
  aiReview?: { text: TextGeneration; signal?: AbortSignal }
}

const report = (issues: ValidationIssue[], checks: string[]): ValidationReport => ({
  ok: !issues.some((i) => i.severity === 'error'),
  issues,
  checks,
  checkedAt: new Date().toISOString(),
})

const schemaIssues = (e: z.ZodError, itemId?: string): ValidationIssue[] =>
  e.issues.map((i) => ({
    severity: 'error',
    code: 'schema.invalid',
    message: `Ogiltig struktur vid ${i.path.join('.') || 'roten'}: ${i.message}`,
    ...(itemId !== undefined && { itemId }),
  }))

/**
 * Validate generated content before it is stored as usable. Runs every programmatic check;
 * see docs/platform/validation.md for the codes and severities.
 */
export async function validateArtifact(artifact: Artifact, ctx: ValidationContext): Promise<ValidationReport> {
  const parsed = ArtifactSchema.safeParse(artifact)
  if (!parsed.success) return report(schemaIssues(parsed.error), ['schema'])
  const a = parsed.data
  const cc: CheckContext = {
    request: ctx.request,
    material: ctx.material,
    band: ageBand(a.school),
    sourceMode: a.sourceMode,
  }
  const issues = Object.values(ARTIFACT_CHECKS).flatMap((check) => check(a, cc))
  const checks = Object.keys(ARTIFACT_CHECKS)
  return finish(allItems(a), issues, checks, ctx)
}

/** Re-validate a single item (e.g. after regenerating it). Artifact-level checks (counts, duplicate ids) are not run. */
export async function validateItem(
  item: unknown,
  ctx: ValidationContext & { school?: SchoolPosition; sourceMode?: SourceMode },
): Promise<ValidationReport> {
  const parsed = ItemSchema.safeParse(item)
  const id = (item as { id?: unknown })?.id
  if (!parsed.success) return report(schemaIssues(parsed.error, typeof id === 'string' ? id : undefined), ['schema'])
  const school = ctx.school ?? ctx.request.school
  const cc: CheckContext = {
    request: ctx.request,
    material: ctx.material,
    band: school ? ageBand(school) : 'middle',
    sourceMode: ctx.sourceMode ?? ctx.request.sourceMode,
  }
  const issues = [
    ...materialMissing([parsed.data], cc),
    ...Object.values(ITEM_CHECKS).flatMap((check) => check(parsed.data, cc)),
  ]
  return finish([parsed.data], issues, ['schema', ...Object.keys(ITEM_CHECKS)], ctx)
}

async function finish(items: Item[], issues: ValidationIssue[], checks: string[], ctx: ValidationContext) {
  const isValid = ctx.isValidRef ?? (ctx.db ? (ref: CurriculumRef) => dbIsValidRef(ctx.db!, ref) : undefined)
  if (isValid) {
    issues.push(...(await curriculum(items, isValid)))
    checks.push('curriculum')
  }
  if (ctx.aiReview) {
    issues.push(...(await aiReview(items, ctx.aiReview)))
    checks.push('aiReview')
  }
  return report(issues, checks)
}

/** Every curriculumRef (and curriculum SourceRef) must exist in the imported curriculum. */
export async function curriculum(
  items: Item[],
  isValid: (ref: CurriculumRef) => Promise<boolean>,
): Promise<ValidationIssue[]> {
  const cache = new Map<string, Promise<boolean | 'unavailable'>>()
  const out: ValidationIssue[] = []
  for (const item of items) {
    const refs = [...item.curriculumRefs, ...item.sources.flatMap((s) => (s.kind === 'curriculum' ? [s.ref] : []))]
    for (const ref of refs) {
      const key = JSON.stringify([ref.version, ref.subjectCode, ref.stage, ref.span, ref.itemId])
      if (!cache.has(key))
        cache.set(
          key,
          isValid(ref).catch(() => 'unavailable' as const),
        )
      const r = await cache.get(key)!
      const label = [ref.subjectCode, ref.span, ref.itemId].filter(Boolean).join(' ')
      if (r === 'unavailable')
        out.push({
          severity: 'warning',
          code: 'curriculum.unavailable',
          itemId: item.id,
          message: `Läroplanskopplingen ${label} kunde inte kontrolleras just nu.`,
        })
      else if (!r)
        out.push({
          severity: 'error',
          code: 'curriculum.invalid_ref',
          itemId: item.id,
          message: `Läroplanskopplingen ${label} finns inte i den importerade läroplanen.`,
        })
    }
  }
  return out
}

const AiFlags = z.object({
  flags: z.array(z.object({ itemId: z.string(), problem: z.string() })).max(60),
})

const AI_SYSTEM =
  'Du granskar skoluppgifter för svenska elever. Peka bara ut uppgifter där frågan eller det angivna rätta ' +
  'svaret innehåller ett sakfel. Var försiktig: flagga bara tydliga fel. Svara med en tom lista om allt ser rätt ut.'

/** Secondary AI signal: flags possible factual errors as warnings. Never errors, never approves. */
export async function aiReview(
  items: Item[],
  opts: { text: TextGeneration; signal?: AbortSignal },
): Promise<ValidationIssue[]> {
  if (!items.length) return []
  const ids = new Set(items.map((i) => i.id))
  const payload = items.map((i) => ({
    id: i.id,
    kind: i.kind,
    prompt: i.prompt,
    answer: i.kind === 'trueFalse' ? (i.answer ? 'sant' : 'falskt') : answerTexts(i).join(' | '),
  }))
  try {
    const { output } = await opts.text.generate({
      system: AI_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
      schema: AiFlags,
      schemaName: 'factual_review',
      temperature: 0,
      maxTokens: 1500,
      signal: opts.signal,
    })
    return output.flags
      .filter((f) => ids.has(f.itemId))
      .map((f) => ({
        severity: 'warning' as const,
        code: 'ai.possible_factual_error',
        itemId: f.itemId,
        message: `AI-granskningen misstänker ett sakfel: ${f.problem.slice(0, 300)}`,
      }))
  } catch {
    return [{ severity: 'warning', code: 'ai.review_unavailable', message: 'AI-granskningen kunde inte genomföras.' }]
  }
}
