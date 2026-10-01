import { and, eq } from 'drizzle-orm'
import { loadProcessedMaterial } from '../study/material'
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
import type { BriefResult } from '../research/brief'
import { isValidRef, subject, suggestRefs } from '../curriculum/service'
import type { Db } from '../db/client'
import { skillEvidence, type IllustrationRequest } from '../db/schema'
import { promptProfile } from '../learners/profile'
import { validateArtifact, type ValidationContext } from '../validation'
import { describeItem, fallbackSkill, genItemsSchema, toItem, type ItemContext } from './items'
import {
  buildSystemPrompt,
  itemsTask,
  repairTask,
  selectMaterial,
  textRepairTask,
  textsTask,
  type MaterialSelection,
  type OfferedRef,
  type PromptInput,
} from './prompts'
import type { ResolvedRequest } from './request'

// Structured generation: blueprint → text call → item calls in chunks → checks → one targeted repair.

/** Provided by server/study/material.ts (loadProcessedMaterial); injected so tests can use fixtures. */
export type MaterialLoader = (db: Db, studySetId: string) => Promise<ProcessedStudyMaterial | undefined>

/** WIRING: replace with `loadProcessedMaterial` from server/study/material.ts once it exists. */
/** Processed study material from the study domain (only for sets that are ready). */
export const defaultMaterialLoader: MaterialLoader = async (db, setId) =>
  (await loadProcessedMaterial(db, setId))?.material

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
  /** Practice tests: difficulty ramp and kind quota for this chunk. */
  ramp?: [number, number]
  quota?: Partial<Record<ItemKind, number>>
}

/** Output budget per call: room for the JSON plus reasoning tokens (truncation doubles it once). */
export const ITEM_TOKENS = 600
const TEXT_TOKENS_PER_WORD = 4

/** Practice test: difficulty rises across the test and item kinds are spread evenly over it. */
function practiceTest(r: ResolvedRequest): Slot[] {
  const n = r.questionCount
  const parts = Math.ceil(n / CHUNK)
  const lo = Math.max(1, r.difficulty - 1)
  const hi = Math.min(5, r.difficulty + 1)
  const kinds = r.itemKinds
  return Array.from({ length: parts }, (_, i) => {
    const start = i * CHUNK
    const count = Math.min(CHUNK, n - start)
    const quota: Partial<Record<ItemKind, number>> = {}
    for (let j = start; j < start + count; j++)
      quota[kinds[j % kinds.length]!] = (quota[kinds[j % kinds.length]!] ?? 0) + 1
    const at = (x: number) => Math.round(lo + ((hi - lo) * x) / n)
    return {
      kind: 'check' as const,
      title: parts > 1 ? `Del ${i + 1}` : undefined,
      items: count,
      ramp: [at(start), at(start + count)] as [number, number],
      quota,
    }
  })
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
      return practiceTest(r)
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
  /** Web research (useWebResearch); items cite its sources as W1..Wn. */
  research?: BriefResult
}

function itemContext(p: Prepared, curriculum: Map<string, CurriculumRef>): ItemContext {
  const r = p.request
  return {
    curriculum,
    material: p.material,
    maxChoices: r.support.maxChoices,
    includeHints: r.hints,
    skills: r.skills,
    fallbackSkill: fallbackSkill(r.subjectCode, r.topic),
    web: r.sourceMode === 'strict' ? undefined : new Map(p.research?.sources.map((s, i) => [`W${i + 1}`, s])),
  }
}

export interface Generated {
  /** Contract artifact without final approval (set by the caller). */
  artifact: Artifact
  ok: boolean
  illustrations: IllustrationRequest[]
  model?: string
  repaired: boolean
  /** Which material reached the prompt when it did not all fit. */
  truncated?: MaterialSelection['truncated']
}

/** Förskoleklass has one curriculum chapter instead of subjects. */
export const FK_CURRICULUM = 'LGR22-FK'

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
  // Förskoleklass: grundskola subject codes don't apply at year 0; search its own chapter instead.
  const fk = r.school.stage === 'forskoleklass'
  const hits = q
    ? await suggestRefs(db, {
        position: r.school,
        subjectCode: fk ? undefined : r.subjectCode,
        text: q,
        limit: 8,
      }).catch(() => [])
    : []
  for (const h of hits) add(h.ref, h.subjectName, h.text, h.area)
  // Lexical search can miss (e.g. "multiplikation" vs "räknesätten"): fall back to the subject's content.
  const fallback = fk ? FK_CURRICULUM : r.subjectCode
  if (!hits.length && fallback) {
    const s = await subject(db, fallback, fk ? undefined : r.school.year).catch(() => null)
    const kinds = fk ? ['central_content', 'goal'] : ['central_content']
    for (const i of s?.items.filter((x) => kinds.includes(x.kind)).slice(0, 8) ?? [])
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

/** The learner's existing skill tags in this subject, so the model reuses them. */
export async function knownSkills(db: Db, learnerId: string, subjectCode?: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ skill: skillEvidence.skill })
    .from(skillEvidence)
    .where(
      and(eq(skillEvidence.learnerId, learnerId), subjectCode ? eq(skillEvidence.subjectCode, subjectCode) : undefined),
    )
    .limit(40)
    .catch(() => [])
  return rows.map((r) => r.skill)
}

/** Material that fits the prompt, chosen by relevance to the request. */
export function materialFor(p: Prepared): MaterialSelection | undefined {
  const r = p.request
  if (!p.material) return undefined
  return selectMaterial(p.material, [r.topic, r.instructions, r.skills?.join(' ')].filter(Boolean).join(' '))
}

export function promptInputFor(p: Prepared, offered: OfferedRef[], knownSkillTags?: string[]): PromptInput {
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
    skills: r.skills,
    knownSkills: knownSkillTags,
    research: p.research && {
      ...p.research.brief,
      sources: p.research.sources.map((s) =>
        s.kind === 'web' ? { title: s.title, publisher: s.publisher } : { title: '' },
      ),
    },
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
  const sel = materialFor(p)
  const skillTags = await knownSkills(deps.db, base.learnerId, r.subjectCode)
  const system = buildSystemPrompt(promptInputFor({ ...p, material: sel?.material }, cur.offered, skillTags))
  const itemCtx = itemContext(p, cur.refs)
  let model: string | undefined
  const call = async <T>(schema: z.ZodType<T>, schemaName: string, task: string, maxTokens: number): Promise<T> => {
    const res = await deps.text.generate({
      system,
      messages: [{ role: 'user', content: task }],
      schema,
      schemaName,
      maxTokens,
      signal: deps.signal,
    })
    model = res.model
    return res.output
  }

  const slots = blueprint(r)
  const textSlots = slots.filter((s) => s.words)
  const textsSchema = z.object({
    title: z.string().min(1).max(200),
    bodies: z.array(z.string().min(1).max(12000)).min(textSlots.length).max(textSlots.length),
  })
  const textTask = textsTask({ type: r.type, sections: textSlots.map((s) => ({ kind: s.kind, words: s.words! })) })
  const textTokens = 600 + TEXT_TOKENS_PER_WORD * textSlots.reduce((n, s) => n + s.words!, 0)
  let title: string | undefined
  const bodies: string[] = []
  if (textSlots.length) {
    await deps.progress?.(0.1, 'Skriver texterna')
    const out = await call(
      textsSchema,
      'artifact_texts',
      [textTask, p.extraContext].filter(Boolean).join('\n\n'),
      textTokens,
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
        itemsTask({
          count,
          kinds: r.itemKinds,
          sectionTitle: slot.title,
          context,
          avoid: prompts.slice(-30),
          ramp: slot.ramp,
          quota: slot.quota,
        }),
        400 + ITEM_TOKENS * count,
      )
      title ??= out.title ?? undefined
      for (const g of out.items) {
        const { item, illustrations: wanted } = toItem(g, `i${nextId++}`, itemCtx)
        section.items.push(item)
        prompts.push(item.prompt.slice(0, 120))
        illustrations.push(...wanted)
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
  // Item errors are repaired per item; safety problems in titles/bodies (no itemId) by rewriting the texts.
  const textErrors = errors.filter((e) => !e.itemId && e.code.startsWith('safety.'))
  const unrepairable = errors.some((e) => !e.itemId && !e.code.startsWith('safety.'))
  if (errors.length && !unrepairable) {
    repaired = true
    await deps.progress?.(0.9, 'Förbättrar uppgifter')
    if (textErrors.length) {
      if (textSlots.length) {
        const out = await call(
          textsSchema,
          'artifact_texts',
          [
            textRepairTask(textErrors.map((e) => e.message)),
            textTask,
            `Underkända texter:\n${JSON.stringify({ title: artifact.title, bodies })}`,
          ].join('\n\n'),
          textTokens,
        )
        let n = 0
        artifact = {
          ...artifact,
          title: out.title.slice(0, 200),
          sections: artifact.sections.map((s, i) => (slots[i]!.words ? { ...s, body: out.bodies[n++] } : s)),
        }
      } else artifact = { ...artifact, title: (r.topic ?? 'Material').slice(0, 200) }
    }
    const failing = new Set(errors.flatMap((e) => (e.itemId ? [e.itemId] : [])))
    const bad = allItems(artifact).filter((i) => failing.has(i.id))
    const replacement = new Map<string, { item: Item; illustrations: IllustrationRequest[] }>()
    // One call per kind: replacements are matched by kind and order within the kind, never across kinds.
    for (const kind of [...new Set(bad.map((i) => i.kind))]) {
      const group = bad.filter((i) => i.kind === kind)
      const ids = new Set(group.map((i) => i.id))
      const out = await call(
        genItemsSchema([kind], group.length),
        'artifact_items',
        repairTask(
          errors.filter((e) => ids.has(e.itemId!)).map((e) => `${e.itemId}: ${e.message}`),
          group.map((b) => ({ id: b.id, ...describeItem(b) })),
        ),
        400 + ITEM_TOKENS * group.length,
      )
      group.forEach((b, n) => replacement.set(b.id, toItem(out.items[n]!, b.id, itemCtx)))
    }
    artifact = {
      ...artifact,
      sections: artifact.sections.map((s) => ({
        ...s,
        items: s.items.map((i) => replacement.get(i.id)?.item ?? i),
      })),
    }
    const kept = illustrations.filter((i) => !replacement.has(i.itemId))
    illustrations.splice(0, illustrations.length, ...kept, ...[...replacement.values()].flatMap((x) => x.illustrations))
    report = await check(deps, artifact, vctx)
  }
  return {
    artifact: { ...artifact, validation: report },
    ok: report.ok,
    illustrations,
    model,
    repaired,
    truncated: sel?.truncated,
  }
}

/** Generate one replacement item of the same kind (artifact.regenerateItem). */
export async function regenerateItem(
  deps: EngineDeps,
  p: Prepared,
  artifact: Artifact,
  itemId: string,
): Promise<{ artifact: Artifact; ok: boolean; illustrations: IllustrationRequest[]; model?: string }> {
  const r = p.request
  const strict = r.sourceMode === 'strict' && !!p.material
  const cur = strict
    ? { offered: [], refs: new Map<string, CurriculumRef>() }
    : await offerCurriculum(deps.db, r, p.material)
  const old = allItems(artifact).find((i) => i.id === itemId)
  if (!old) throw new Error('item missing')
  const res = await deps.text.generate({
    system: buildSystemPrompt(
      promptInputFor(
        { ...p, material: materialFor(p)?.material },
        cur.offered,
        await knownSkills(deps.db, artifact.learnerId, r.subjectCode),
      ),
    ),
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
    maxTokens: 400 + ITEM_TOKENS,
    signal: deps.signal,
  })
  const { item, illustrations } = toItem(res.output.items[0]!, itemId, itemContext(p, cur.refs))
  const next: Artifact = {
    ...artifact,
    sections: artifact.sections.map((s) => ({ ...s, items: s.items.map((i) => (i.id === itemId ? item : i)) })),
  }
  const report = await check(deps, next, { request: r, material: p.material })
  return { artifact: { ...next, validation: report }, ok: report.ok, illustrations, model: res.model }
}

/** Re-validate an edited artifact. */
export async function revalidate(deps: Pick<EngineDeps, 'validate'>, a: Artifact, ctx: ValidationContext) {
  return check(deps as EngineDeps, a, ctx)
}
