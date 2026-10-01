import { z } from 'zod'
import type { CurriculumRef, Item, ItemKind, ProcessedStudyMaterial, SourceRef } from '../../shared/contracts'
import { SKILL_TAG } from '../adaptive/paths'
import type { IllustrationRequest } from '../db/schema'

// Model-facing item schema: smaller than the contract (no ids, sources or media; choices are
// plain strings). The server assigns ids, sources and refs in `toItem`.
// Optional fields are nullable *and required* in the JSON Schema (null when absent; zod fills a
// missing one with null), so OpenAI strict mode applies and decoding is constrained.

/** Model-facing optional field: required + nullable for the provider, null when left out. */
const opt = <T extends z.ZodType>(t: T) => t.nullable().default(null)

export const ITEM_KINDS = [
  'multipleChoice',
  'multiSelect',
  'trueFalse',
  'fillBlank',
  'matching',
  'ordering',
  'numeric',
  'freeText',
  'flashcard',
] as const satisfies readonly ItemKind[]

const Common = {
  prompt: z.string().min(1).max(2000),
  lang: opt(z.string().min(2).max(5)),
  hints: opt(z.array(z.string().max(500)).max(4)),
  explanation: opt(z.string().max(2000)),
  difficulty: z.number().int().min(1).max(5),
  skills: z.array(z.string().max(120)).min(1).max(6),
  /** Ids from the offered curriculum list ("C1", ...). */
  curriculumIds: opt(z.array(z.string()).max(6)),
  /** Segment ids from the study material. */
  sourceSegmentIds: opt(z.array(z.string()).max(6)),
  /** Web research source ids ("W1", ...) the item's facts come from. */
  webSourceIds: opt(z.array(z.string()).max(5)),
  /** Short description of a helpful illustration (hook for the image domain). */
  illustration: opt(z.string().max(300)),
  /** 1–3 words to search licensed photos of the concrete thing shown (e.g. "red apple"). */
  imageQuery: opt(z.string().max(60)),
}

/** One search term per choice, only when every choice is a concrete, picturable thing. */
const choiceImageQueries = opt(z.array(z.string().max(60)).max(8))

const GEN_KINDS = {
  multipleChoice: z.object({
    kind: z.literal('multipleChoice'),
    ...Common,
    choices: z.array(z.string().max(500)).min(2).max(6),
    choiceImageQueries,
    correctIndex: z.number().int().min(0),
  }),
  multiSelect: z.object({
    kind: z.literal('multiSelect'),
    ...Common,
    choices: z.array(z.string().max(500)).min(2).max(8),
    choiceImageQueries,
    correctIndexes: z.array(z.number().int().min(0)).min(1),
  }),
  trueFalse: z.object({ kind: z.literal('trueFalse'), ...Common, answer: z.boolean() }),
  fillBlank: z.object({
    kind: z.literal('fillBlank'),
    ...Common,
    text: z.string().max(2000),
    blanks: z
      .array(z.array(z.string().max(100)).min(1))
      .min(1)
      .max(10),
  }),
  matching: z.object({
    kind: z.literal('matching'),
    ...Common,
    pairs: z
      .array(z.object({ left: z.string().max(200), right: z.string().max(200) }))
      .min(2)
      .max(10),
  }),
  ordering: z.object({
    kind: z.literal('ordering'),
    ...Common,
    /** In the correct order; the server shuffles for display. */
    correctOrder: z.array(z.string().max(500)).min(2).max(10),
  }),
  numeric: z.object({
    kind: z.literal('numeric'),
    ...Common,
    answer: z.number(),
    tolerance: opt(z.number().nonnegative()),
    unit: opt(z.string().max(30)),
    check: opt(z.string().max(300)),
  }),
  freeText: z.object({
    kind: z.literal('freeText'),
    ...Common,
    rubric: z.array(z.string().max(300)).min(1).max(8),
    sampleAnswer: opt(z.string().max(2000)),
  }),
  flashcard: z.object({ kind: z.literal('flashcard'), ...Common, back: z.string().max(1000) }),
}

/** Parsed model item (nulls for absent optional fields). Tests may build it with fields left out. */
export type GenItem = z.input<(typeof GEN_KINDS)[ItemKind]>

/** Union of only the allowed kinds, so the model cannot produce others. */
export function genItemSchema(kinds: readonly ItemKind[]): z.ZodType<GenItem> {
  const opts = kinds.map((k) => GEN_KINDS[k])
  if (opts.length === 1) return opts[0]! as z.ZodType<GenItem>
  return z.discriminatedUnion('kind', opts as never) as z.ZodType<GenItem>
}

export function genItemsSchema(kinds: readonly ItemKind[], count: number) {
  return z.object({
    title: opt(z.string().max(200)),
    items: z.array(genItemSchema(kinds)).min(count).max(count),
  })
}

export interface ItemContext {
  /** Offered curriculum refs by local id ("C1" → ref). */
  curriculum: Map<string, CurriculumRef>
  material?: ProcessedStudyMaterial
  maxChoices: number
  includeHints: boolean
  /** Web research sources by local id ("W1" → web SourceRef). */
  web?: Map<string, SourceRef>
  /** GenerationRequest.skills: every item carries these tags or finer ones. */
  skills?: string[]
  /** Used when none of the model's tags is a valid skill tag (e.g. "mat.multiplikation"). */
  fallbackSkill?: string
}

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-*\.-*/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')

/** Model tag → adaptive skill tag (lowercase slug segments), or undefined when it can't be one. */
export function normalizeSkill(tag: string): string | undefined {
  const t = slug(tag)
  return SKILL_TAG.test(t) ? t : undefined
}

/** Subject-derived fallback tag: "GRGRMAT01" + "Multiplikation" → "mat.multiplikation". */
export function fallbackSkill(subjectCode: string | undefined, topic: string | undefined): string {
  const subj = slug((subjectCode ?? '').replace(/^GRGR/i, '').replace(/\d+$/, '')) || 'allmant'
  const area =
    slug(topic ?? '')
      .replace(/\./g, '-')
      .slice(0, 40)
      .replace(/-+$/, '') || 'allmant'
  return normalizeSkill(`${/^[a-z]/.test(subj) ? subj : `s${subj}`}.${area}`) ?? 'allmant.allmant'
}

/**
 * Item tags under the requested skills: the model's tags that equal or refine a requested tag
 * (only the finest of a chain: roll-up would count one answer twice), else the requested tags.
 */
export function itemSkills(raw: string[], required?: string[], fallback = 'allmant.allmant'): string[] {
  const model = [...new Set(raw.flatMap((t) => normalizeSkill(t) ?? []))]
  if (!required?.length) return model.length ? model.slice(0, 6) : [fallback]
  const fits = [...new Set(model.filter((s) => required.some((t) => s === t || s.startsWith(`${t}.`))))]
  const finest = fits.filter((s) => !fits.some((o) => o.startsWith(`${s}.`)))
  return (finest.length ? finest : required).slice(0, 6)
}

const choice = (text: string, i: number) => ({ id: `c${i + 1}`, text })

const orUndef = <T>(v: T | null | undefined): T | undefined => v ?? undefined

/** Keep the answer(s) and the first distractors up to `max` options. */
function limitChoices<T>(choices: T[], keep: (i: number) => boolean, max: number): number[] {
  const idx = choices.map((_, i) => i)
  const needed = idx.filter(keep)
  const rest = idx.filter((i) => !keep(i)).slice(0, Math.max(0, max - needed.length))
  return idx.filter((i) => needed.includes(i) || rest.includes(i))
}

/** Generated item → contract Item (server-assigned id, sources and refs). */
export function toItem(g: GenItem, id: string, ctx: ItemContext): { item: Item; illustrations: IllustrationRequest[] } {
  const curriculumRefs = (g.curriculumIds ?? []).flatMap((c) => ctx.curriculum.get(c) ?? [])
  const segs = ctx.material?.segments ?? []
  const sources: SourceRef[] = (g.sourceSegmentIds ?? []).flatMap((sid) => {
    const s = segs.find((x) => x.id === sid)
    return s
      ? [
          {
            kind: 'upload' as const,
            studySetId: ctx.material!.studySetId,
            page: s.page,
            segmentId: s.id,
            excerpt: s.text.slice(0, 200),
          },
        ]
      : []
  })
  for (const w of new Set(g.webSourceIds)) {
    const ref = ctx.web?.get(w)
    if (ref) sources.push(ref)
  }
  for (const ref of curriculumRefs) sources.push({ kind: 'curriculum', ref })
  if (!sources.length) sources.push({ kind: 'model', capability: 'text' })

  const base = {
    id,
    prompt: g.prompt,
    lang: g.lang ?? 'sv',
    media: [],
    hints: ctx.includeHints ? (g.hints ?? []) : [],
    explanation: orUndef(g.explanation),
    difficulty: g.difficulty,
    skills: itemSkills(g.skills, ctx.skills, ctx.fallbackSkill),
    sources,
    curriculumRefs,
  }
  let item: Item
  switch (g.kind) {
    case 'multipleChoice': {
      const keep = limitChoices(g.choices, (i) => i === g.correctIndex, ctx.maxChoices)
      const choices = keep.map((i, n) => choice(g.choices[i]!, n))
      const answer = choices[keep.indexOf(g.correctIndex)]?.id ?? 'missing'
      item = { ...base, kind: g.kind, choices, answer }
      break
    }
    case 'multiSelect': {
      const correct = [...new Set(g.correctIndexes)]
      // At least one wrong option must stay, or every answer is right. If that breaks maxChoices,
      // ask for one answer instead (multiple choice with the first correct option).
      if (correct.length + 1 > ctx.maxChoices && g.choices.length > correct.length) {
        const first = correct[0]!
        // Other correct options would make a single answer ambiguous: only wrong ones stay as distractors.
        const wrong = g.choices.map((_, i) => i).filter((i) => !correct.includes(i))
        const picked = [first, ...wrong.slice(0, ctx.maxChoices - 1)].sort((x, y) => x - y)
        const choices = picked.map((i, n) => choice(g.choices[i]!, n))
        item = { ...base, kind: 'multipleChoice', choices, answer: choices[picked.indexOf(first)]!.id }
        break
      }
      const keep = limitChoices(g.choices, (i) => correct.includes(i), Math.max(ctx.maxChoices, correct.length + 1))
      const choices = keep.map((i, n) => choice(g.choices[i]!, n))
      const answers = correct.map((ci) => choices[keep.indexOf(ci)]?.id ?? 'missing')
      item = { ...base, kind: g.kind, choices, answers }
      break
    }
    case 'ordering': {
      const correct = g.correctOrder.map(choice)
      let shown = [...correct].sort((a, b) => a.text.localeCompare(b.text, 'sv'))
      if (shown.every((c, i) => c.id === correct[i]!.id)) shown = shown.reverse()
      item = { ...base, kind: g.kind, items: shown, answer: correct.map((c) => c.id) }
      break
    }
    case 'fillBlank':
      item = { ...base, kind: g.kind, text: g.text, blanks: g.blanks.map((accepted) => ({ accepted })) }
      break
    case 'numeric':
      item = {
        ...base,
        kind: g.kind,
        answer: g.answer,
        tolerance: g.tolerance ?? 0,
        unit: orUndef(g.unit),
        check: orUndef(g.check),
      }
      break
    case 'trueFalse':
      item = { ...base, kind: g.kind, answer: g.answer }
      break
    case 'matching':
      item = { ...base, kind: g.kind, pairs: g.pairs }
      break
    case 'freeText':
      item = { ...base, kind: g.kind, rubric: g.rubric, sampleAnswer: orUndef(g.sampleAnswer) }
      break
    case 'flashcard':
      item = { ...base, kind: g.kind, back: g.back }
      break
  }
  return { item, illustrations: illustrationsOf(g, item) }
}

function illustrationsOf(g: GenItem, item: Item): IllustrationRequest[] {
  const out: IllustrationRequest[] = []
  const description = g.illustration ?? g.imageQuery
  if (description) out.push({ itemId: item.id, description, ...(g.imageQuery ? { query: g.imageQuery } : {}) })
  if (!('choiceImageQueries' in g) || !g.choiceImageQueries || !('choices' in item)) return out
  const queries = g.choiceImageQueries
  item.choices.forEach((c, n) => {
    const query = queries[g.choices.indexOf(c.text)]?.trim()
    if (query) out.push({ itemId: item.id, description: c.text, query, choice: n })
  })
  return out
}

/** Contract item → compact model-facing form (for transforms and targeted regeneration context). */
export function describeItem(item: Item): Record<string, unknown> {
  const { id: _i, sources: _s, media: _m, curriculumRefs: _c, ...rest } = item
  return rest
}
