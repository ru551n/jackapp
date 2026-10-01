import { z } from 'zod'
import type { CurriculumRef, Item, ItemKind, ProcessedStudyMaterial, SourceRef } from '../../shared/contracts'
import type { IllustrationRequest } from '../db/schema'

// Model-facing item schema: smaller than the contract (no ids, sources or media; choices are
// plain strings). The server assigns ids, sources and refs in `toItem`.

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
  lang: z.string().min(2).max(5).optional(),
  hints: z.array(z.string().max(500)).max(4).optional(),
  explanation: z.string().max(2000).optional(),
  difficulty: z.number().int().min(1).max(5),
  skills: z.array(z.string().max(120)).min(1).max(6),
  /** Ids from the offered curriculum list ("C1", ...). */
  curriculumIds: z.array(z.string()).max(6).optional(),
  /** Segment ids from the study material. */
  sourceSegmentIds: z.array(z.string()).max(6).optional(),
  /** Short description of a helpful illustration (hook for the image domain). */
  illustration: z.string().max(300).optional(),
}

const GEN_KINDS = {
  multipleChoice: z.object({
    kind: z.literal('multipleChoice'),
    ...Common,
    choices: z.array(z.string().max(500)).min(2).max(6),
    correctIndex: z.number().int().min(0),
  }),
  multiSelect: z.object({
    kind: z.literal('multiSelect'),
    ...Common,
    choices: z.array(z.string().max(500)).min(2).max(8),
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
    tolerance: z.number().nonnegative().optional(),
    unit: z.string().max(30).optional(),
    check: z.string().max(300).optional(),
  }),
  freeText: z.object({
    kind: z.literal('freeText'),
    ...Common,
    rubric: z.array(z.string().max(300)).min(1).max(8),
    sampleAnswer: z.string().max(2000).optional(),
  }),
  flashcard: z.object({ kind: z.literal('flashcard'), ...Common, back: z.string().max(1000) }),
}

export type GenItem = z.infer<(typeof GEN_KINDS)[ItemKind]>

/** Union of only the allowed kinds, so the model cannot produce others. */
export function genItemSchema(kinds: readonly ItemKind[]): z.ZodType<GenItem> {
  const opts = kinds.map((k) => GEN_KINDS[k])
  if (opts.length === 1) return opts[0]! as z.ZodType<GenItem>
  return z.discriminatedUnion('kind', opts as never) as z.ZodType<GenItem>
}

export function genItemsSchema(kinds: readonly ItemKind[], count: number) {
  return z.object({
    title: z.string().max(200).optional(),
    items: z.array(genItemSchema(kinds)).min(count).max(count),
  })
}

export interface ItemContext {
  /** Offered curriculum refs by local id ("C1" → ref). */
  curriculum: Map<string, CurriculumRef>
  material?: ProcessedStudyMaterial
  maxChoices: number
  includeHints: boolean
  /** GenerationRequest.skills: every item carries these tags or finer ones. */
  skills?: string[]
}

/**
 * Item tags under the requested skills: the model's tags that equal or refine a requested tag
 * (only the finest of a chain: roll-up would count one answer twice), else the requested tags.
 */
export function itemSkills(model: string[], required?: string[]): string[] {
  if (!required?.length) return model
  const fits = [...new Set(model.filter((s) => required.some((t) => s === t || s.startsWith(`${t}.`))))]
  const finest = fits.filter((s) => !fits.some((o) => o.startsWith(`${s}.`)))
  return (finest.length ? finest : required).slice(0, 6)
}

const choice = (text: string, i: number) => ({ id: `c${i + 1}`, text })

/** Keep the answer(s) and the first distractors up to `max` options. */
function limitChoices<T>(choices: T[], keep: (i: number) => boolean, max: number): number[] {
  const idx = choices.map((_, i) => i)
  const needed = idx.filter(keep)
  const rest = idx.filter((i) => !keep(i)).slice(0, Math.max(0, max - needed.length))
  return idx.filter((i) => needed.includes(i) || rest.includes(i))
}

/** Generated item → contract Item (server-assigned id, sources and refs). */
export function toItem(g: GenItem, id: string, ctx: ItemContext): { item: Item; illustration?: IllustrationRequest } {
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
  for (const ref of curriculumRefs) sources.push({ kind: 'curriculum', ref })
  if (!sources.length) sources.push({ kind: 'model', capability: 'text' })

  const base = {
    id,
    prompt: g.prompt,
    lang: g.lang ?? 'sv',
    media: [],
    hints: ctx.includeHints ? (g.hints ?? []) : [],
    explanation: g.explanation,
    difficulty: g.difficulty,
    skills: itemSkills(g.skills, ctx.skills),
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
      const keep = limitChoices(g.choices, (i) => g.correctIndexes.includes(i), Math.max(ctx.maxChoices, 2))
      const choices = keep.map((i, n) => choice(g.choices[i]!, n))
      const answers = g.correctIndexes.map((ci) => choices[keep.indexOf(ci)]?.id ?? 'missing')
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
      item = { ...base, kind: g.kind, answer: g.answer, tolerance: g.tolerance ?? 0, unit: g.unit, check: g.check }
      break
    case 'trueFalse':
      item = { ...base, kind: g.kind, answer: g.answer }
      break
    case 'matching':
      item = { ...base, kind: g.kind, pairs: g.pairs }
      break
    case 'freeText':
      item = { ...base, kind: g.kind, rubric: g.rubric, sampleAnswer: g.sampleAnswer }
      break
    case 'flashcard':
      item = { ...base, kind: g.kind, back: g.back }
      break
  }
  return { item, illustration: g.illustration ? { itemId: id, description: g.illustration } : undefined }
}

/** Contract item → compact model-facing form (for transforms and targeted regeneration context). */
export function describeItem(item: Item): Record<string, unknown> {
  const { id: _i, sources: _s, media: _m, curriculumRefs: _c, ...rest } = item
  return rest
}
