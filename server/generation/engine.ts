import { z } from 'zod'
import {
  ageBand,
  type Artifact,
  type CurriculumRef,
  type Item,
  type ItemKind,
  type LearnerProfileInput,
  type ProcessedStudyMaterial,
  type Section,
  type ValidationIssue,
  type ValidationReport,
} from '../../shared/contracts'
import type { TextGeneration } from '../ai'
import { isValidRef, subject, suggestRefs } from '../curriculum/service'
import type { Db } from '../db/client'
import type { IllustrationRequest } from '../db/schema'
import { promptProfile } from '../learners/profile'
import { validateArtifact, type ValidationContext } from '../validation'
import { describeItem, genItemsSchema, toItem, type GenItem, type ItemContext } from './items'
import { buildSystemPrompt, itemsTask, repairTask, textsTask, type OfferedRef, type PromptInput } from './prompts'
import type { ResolvedRequest } from './request'

// Structured generation: blueprint → text call → item calls in chunks → checks → one targeted repair.

/** Provided by server/study/material.ts (loadProcessedMaterial); injected so tests can use fixtures. */
export type MaterialLoader = (db: Db, studySetId: string) => Promise<ProcessedStudyMaterial | undefined>

/** WIRING: replace with `loadProcessedMaterial` from server/study/material.ts once it exists. */
export const defaultMaterialLoader: MaterialLoader = async () => undefined

export interface EngineDeps {
  db: Db
  text: TextGeneration
  validate?: (a: Artifact, ctx: ValidationContext) => Promise<ValidationReport>
  signal?: AbortSignal
  progress?: (p: number, step?: string) => Promise<void>
}

/** Max items per model call; larger sets are generated chunk by chunk. */
export const CHUNK = 10

type SectionKind = Section['kind']
interface Slot {
  kind: SectionKind
  title?: string
  words?: number
  items?: number
  kinds?: ItemKind[]
}

const WORDS = { early: 40, middle: 90, upper: 160 } as const
const TEXT_FACTOR = { minimal: 0.5, reduced: 0.7, normal: 1 } as const

/** Section layout per artifact type; length depends on age band, support and time. */
export function blueprint(r: ResolvedRequest): Slot[] {
  const w = Math.round(
    WORDS[ageBand(r.school)] * TEXT_FACTOR[r.support.textAmount] * (r.durationMinutes >= 30 ? 1.5 : 1),
  )
  const n = r.questionCount
  const few = Math.min(n, 3)
  const chunked = (kind: SectionKind, total: number): Slot[] => {
    const parts = Math.ceil(total / CHUNK)
    return Array.from({ length: parts }, (_, i) => ({
      kind,
      title: parts > 1 ? `Del ${i + 1}` : undefined,
      items: Math.min(CHUNK, total - i * CHUNK),
    }))
  }
  switch (r.type) {
    case 'lesson': {
      const practice = Math.max(1, Math.ceil(n * 0.6))
      return [
        { kind: 'intro', title: 'Introduktion', words: w },
        { kind: 'explanation', title: 'Förklaring', words: Math.round(w * 1.5) },
        { kind: 'example', title: 'Exempel', words: w },
        { kind: 'practice', title: 'Öva', items: practice },
        { kind: 'recap', title: 'Sammanfattning', words: Math.round(w * 0.7) },
        { kind: 'check', title: 'Kunskapskoll', items: Math.max(1, n - practice) },
      ]
    }
    case 'readingComprehension':
      return [
        { kind: 'text', words: w * 3 },
        { kind: 'check', title: 'Frågor', items: n },
      ]
    case 'story':
    case 'summary':
      return [
        { kind: 'text', words: w * 3 },
        { kind: 'check', title: 'Frågor', items: few },
      ]
    case 'explanation':
      return [
        { kind: 'explanation', words: w * 2 },
        { kind: 'example', title: 'Exempel', words: w },
        { kind: 'check', title: 'Kunskapskoll', items: few },
      ]
    case 'writingPrompt':
      return [{ kind: 'task', words: w, items: few }]
    case 'project':
      return [
        { kind: 'intro', title: 'Projektet', words: w },
        { kind: 'task', title: 'Uppgifter', words: w, items: Math.min(n, 5) },
      ]
    case 'worksheet':
      return chunked('task', n)
    case 'practiceTest':
      return chunked('check', n)
    default:
      return chunked('practice', n)
  }
}

export interface Prepared {
  request: ResolvedRequest
  profile: LearnerProfileInput
  material?: ProcessedStudyMaterial
  /** Extra context for transforms (previous version) and things to avoid repeating. */
  extraContext?: string
  avoid?: string[]
}

export interface Generated {
  /** Contract artifact without final approval (set by the caller). */
  artifact: Artifact
  ok: boolean
  illustrations: IllustrationRequest[]
  model?: string
  repaired: boolean
}

/** Curriculum offered to the model: real central-content texts with local ids C1..Cn. */
export async function offerCurriculum(
  db: Db,
  r: ResolvedRequest,
  material?: ProcessedStudyMaterial,
): Promise<{ offered: OfferedRef[]; refs: Map<string, CurriculumRef> }> {
  const offered: OfferedRef[] = []
  const refs = new Map<string, CurriculumRef>()
  const add = (ref: CurriculumRef, subjectName: string, text: string, area?: string | null) => {
    if ([...refs.values()].some((x) => x.itemId === ref.itemId && x.subjectCode === ref.subjectCode)) return
    const id = `C${refs.size + 1}`
    refs.set(id, ref)
    offered.push({ id, subjectName, text, area })
  }
  // Adult-chosen and material-derived refs first, then search hits.
  for (const ref of [...r.curriculumRefs, ...(material?.curriculumRefs ?? [])]) {
    if (!ref.itemId || !(await isValidRef(db, ref))) continue
    const s = await subject(db, ref.subjectCode).catch(() => null)
    const item = s?.items.find((i) => i.id === ref.itemId)
    if (s && item) add(ref, s.name, item.text, item.area)
  }
  const q = [r.topic, r.instructions, material?.topic, material?.concepts.join(' ')].filter(Boolean).join(' ')
  const hits = q
    ? await suggestRefs(db, { position: r.school, subjectCode: r.subjectCode, text: q, limit: 8 }).catch(() => [])
    : []
  for (const h of hits) add(h.ref, h.subjectName, h.text, h.area)
  // Lexical search can miss (e.g. "multiplikation" vs "räknesätten"): fall back to the subject's content.
  if (!hits.length && r.subjectCode) {
    const s = await subject(db, r.subjectCode, r.school.year).catch(() => null)
    for (const i of s?.items.filter((x) => x.kind === 'central_content').slice(0, 8) ?? [])
      add(
        {
          source: 'skolverket',
          version: s!.version,
          subjectCode: s!.code,
          stage: s!.stage as never,
          span: i.span ?? undefined,
          itemId: i.id,
        },
        s!.name,
        i.text,
        i.area,
      )
  }
  return { offered: offered.slice(0, 10), refs }
}

export function promptInputFor(p: Prepared, offered: OfferedRef[]): PromptInput {
  const r = p.request
  return {
    type: r.type,
    school: r.school,
    band: ageBand(r.school),
    profileText: promptProfile({ ...p.profile, school: r.school, support: r.support }),
    support: r.support,
    difficulty: r.difficulty,
    theme: r.theme,
    hasInterests: p.profile.interests.length + p.profile.themes.length > 0,
    subjectCode: r.subjectCode,
    topic: r.topic,
    sourceMode: r.sourceMode,
    material: p.material,
    curriculum: offered,
    hints: r.hints,
    feedback: r.feedback,
    durationMinutes: r.durationMinutes,
    includeImages: r.includeImages,
  }
}

/** Own structural checks that the validator may not know about (strict grounding, answer ids). */
export function localIssues(a: Artifact): ValidationIssue[] {
  const out: ValidationIssue[] = []
  for (const it of a.sections.flatMap((s) => s.items)) {
    if (a.sourceMode === 'strict' && !it.sources.some((s) => s.kind === 'upload'))
      out.push({
        severity: 'error',
        code: 'strict_source',
        itemId: it.id,
        message: 'Uppgiften saknar källa i det uppladdade materialet.',
      })
    const ids = 'choices' in it ? it.choices.map((c) => c.id) : []
    const answers = it.kind === 'multipleChoice' ? [it.answer] : it.kind === 'multiSelect' ? it.answers : []
    if (answers.some((x) => !ids.includes(x)))
      out.push({
        severity: 'error',
        code: 'answer_missing',
        itemId: it.id,
        message: 'Rätt svar finns inte bland alternativen.',
      })
  }
  return out
}

async function check(deps: EngineDeps, a: Artifact, ctx: ValidationContext): Promise<ValidationReport> {
  const report = await (deps.validate ?? validateArtifact)(a, ctx)
  const own = localIssues(a).filter((i) => !report.issues.some((x) => x.code === i.code && x.itemId === i.itemId))
  const issues = [...report.issues, ...own]
  return {
    ...report,
    ok: report.ok && !own.length,
    issues,
    checks: [...new Set([...report.checks, 'local'])],
  }
}

const allItems = (a: Artifact) => a.sections.flatMap((s) => s.items)

/** Generate a complete artifact (unsaved). `base` supplies id/learner/createdBy/version. */
export async function generateArtifact(
  deps: EngineDeps,
  p: Prepared,
  base: Pick<Artifact, 'id' | 'learnerId' | 'createdBy' | 'version'>,
): Promise<Generated> {
  const r = p.request
  const strict = r.sourceMode === 'strict' && !!p.material
  const cur = strict
    ? { offered: [], refs: new Map<string, CurriculumRef>() }
    : await offerCurriculum(deps.db, r, p.material)
  const system = buildSystemPrompt(promptInputFor(p, cur.offered))
  const itemCtx: ItemContext = {
    curriculum: cur.refs,
    material: p.material,
    maxChoices: r.support.maxChoices,
    includeHints: r.hints,
  }
  let model: string | undefined
  const call = async <T>(schema: z.ZodType<T>, schemaName: string, task: string): Promise<T> => {
    const res = await deps.text.generate({
      system,
      messages: [{ role: 'user', content: task }],
      schema,
      schemaName,
      signal: deps.signal,
    })
    model = res.model
    return res.output
  }

  const slots = blueprint(r)
  const textSlots = slots.filter((s) => s.words)
  let title: string | undefined
  const bodies: string[] = []
  if (textSlots.length) {
    await deps.progress?.(0.1, 'Skriver texterna')
    const out = await call(
      z.object({
        title: z.string().min(1).max(200),
        bodies: z.array(z.string().min(1).max(12000)).min(textSlots.length).max(textSlots.length),
      }),
      'artifact_texts',
      [textsTask({ type: r.type, sections: textSlots.map((s) => ({ kind: s.kind, words: s.words! })) }), p.extraContext]
        .filter(Boolean)
        .join('\n\n'),
    )
    title = out.title
    bodies.push(...out.bodies)
  }

  const context = [p.extraContext, bodies.join('\n\n').slice(0, 8000)].filter(Boolean).join('\n\n')
  const sections: Section[] = []
  const illustrations: IllustrationRequest[] = []
  const prompts: string[] = [...(p.avoid ?? [])]
  let nextId = 1
  let bodyIndex = 0
  const totalItems = slots.reduce((n, s) => n + (s.items ?? 0), 0)
  let done = 0
  for (const slot of slots) {
    const section: Section = {
      kind: slot.kind,
      title: slot.title,
      body: slot.words ? bodies[bodyIndex++] : undefined,
      media: [],
      items: [],
    }
    for (let left = slot.items ?? 0; left > 0;) {
      const count = Math.min(CHUNK, left)
      await deps.progress?.(0.2 + 0.6 * (done / Math.max(1, totalItems)), 'Skapar uppgifter')
      const out = await call(
        genItemsSchema(r.itemKinds, count),
        'artifact_items',
        itemsTask({ count, kinds: r.itemKinds, sectionTitle: slot.title, context, avoid: prompts.slice(-30) }),
      )
      title ??= out.title
      for (const g of out.items) {
        const { item, illustration } = toItem(g, `i${nextId++}`, itemCtx)
        section.items.push(item)
        prompts.push(item.prompt.slice(0, 120))
        if (illustration) illustrations.push(illustration)
      }
      left -= count
      done += count
    }
    sections.push(section)
  }

  let artifact: Artifact = {
    ...base,
    type: r.type,
    title: (title ?? r.topic ?? 'Material').slice(0, 200),
    subjectCode: r.subjectCode,
    school: r.school,
    sourceMode: r.sourceMode,
    studySetId: r.studySetId,
    sections,
    feedback: r.feedback,
    approval: 'draft',
    validation: { ok: false, issues: [], checks: [], checkedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
  }

  await deps.progress?.(0.85, 'Kontrollerar')
  const vctx: ValidationContext = { request: r, material: p.material }
  let report = await check(deps, artifact, vctx)
  let repaired = false
  const errors = report.issues.filter((i) => i.severity === 'error')
  const failing = new Set(errors.map((e) => e.itemId))
  if (errors.length && !failing.has(undefined)) {
    // One targeted regeneration of the failing items only.
    repaired = true
    await deps.progress?.(0.9, 'Förbättrar uppgifter')
    const bad = allItems(artifact).filter((i) => failing.has(i.id))
    const kinds = [...new Set(bad.map((i) => i.kind))]
    const out = await call(
      genItemsSchema(kinds, bad.length),
      'artifact_items',
      repairTask(
        errors.map((e) => `${e.itemId}: ${e.message}`),
        bad.map(describeItem),
      ),
    )
    const replacement = new Map<string, { item: Item; illustration?: IllustrationRequest }>(
      bad.map((b, n) => [b.id, toItem(out.items[n] as GenItem, b.id, itemCtx)]),
    )
    artifact = {
      ...artifact,
      sections: artifact.sections.map((s) => ({
        ...s,
        items: s.items.map((i) => replacement.get(i.id)?.item ?? i),
      })),
    }
    for (const [id, x] of replacement) {
      const at = illustrations.findIndex((i) => i.itemId === id)
      if (at >= 0) illustrations.splice(at, 1)
      if (x.illustration) illustrations.push(x.illustration)
    }
    report = await check(deps, artifact, vctx)
  }
  return { artifact: { ...artifact, validation: report }, ok: report.ok, illustrations, model, repaired }
}

/** Generate one replacement item of the same kind (artifact.regenerateItem). */
export async function regenerateItem(
  deps: EngineDeps,
  p: Prepared,
  artifact: Artifact,
  itemId: string,
): Promise<{ artifact: Artifact; ok: boolean; illustration?: IllustrationRequest; model?: string }> {
  const r = p.request
  const strict = r.sourceMode === 'strict' && !!p.material
  const cur = strict
    ? { offered: [], refs: new Map<string, CurriculumRef>() }
    : await offerCurriculum(deps.db, r, p.material)
  const old = allItems(artifact).find((i) => i.id === itemId)
  if (!old) throw new Error('item missing')
  const res = await deps.text.generate({
    system: buildSystemPrompt(promptInputFor(p, cur.offered)),
    messages: [
      {
        role: 'user',
        content: itemsTask({
          count: 1,
          kinds: [old.kind],
          context: `Ersätt denna uppgift med en ny, likvärdig uppgift:\n${JSON.stringify(describeItem(old))}`,
          avoid: allItems(artifact).map((i) => i.prompt.slice(0, 120)),
        }),
      },
    ],
    schema: genItemsSchema([old.kind], 1),
    schemaName: 'artifact_items',
    signal: deps.signal,
  })
  const { item, illustration } = toItem(res.output.items[0]!, itemId, {
    curriculum: cur.refs,
    material: p.material,
    maxChoices: r.support.maxChoices,
    includeHints: r.hints,
  })
  const next: Artifact = {
    ...artifact,
    sections: artifact.sections.map((s) => ({ ...s, items: s.items.map((i) => (i.id === itemId ? item : i)) })),
  }
  const report = await check(deps, next, { request: r, material: p.material })
  return { artifact: { ...next, validation: report }, ok: report.ok, illustration, model: res.model }
}

/** Re-validate an edited artifact. */
export async function revalidate(deps: Pick<EngineDeps, 'validate'>, a: Artifact, ctx: ValidationContext) {
  return check(deps as EngineDeps, a, ctx)
}
