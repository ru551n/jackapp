import { z } from 'zod'
import type { ItemKind } from '../../shared/contracts'

// Request/response contracts for interactive runs, exported for the web app. Docs: docs/platform/runs.md

/** Self-rating for flashcards and free-text self-assessment. */
export const SelfRating = z.enum(['knew', 'partly', 'notYet'])
export type SelfRating = z.infer<typeof SelfRating>

/** The answer shape per item kind. */
export const AnswerByKind = {
  multipleChoice: z.string().max(100), // choice id
  multiSelect: z.array(z.string().max(100)).max(8), // choice ids
  trueFalse: z.boolean(),
  fillBlank: z.array(z.string().max(200)).max(10), // one entry per blank, in order
  matching: z.array(z.string().max(200)).max(10), // chosen right side per pair, in the item's left order
  ordering: z.array(z.string().max(100)).max(10), // item ids in chosen order
  numeric: z.union([z.string().max(100), z.number()]), // "3,5", "3/4", "12 cm"
  freeText: z.object({ text: z.string().max(4000), selfRating: SelfRating.optional() }),
  flashcard: SelfRating,
} satisfies Record<ItemKind, z.ZodType>

export const StartRunRequest = z.object({ artifactId: z.string().uuid() })

export const SubmitAnswerRequest = z.object({
  itemId: z.string().max(200),
  /** Client attempt counter (1-based). Resubmitting the same attempt replays the stored result. */
  attempt: z.number().int().min(1).max(100).optional(),
  /** Validated against AnswerByKind[item.kind]. */
  answer: z.unknown(),
})

export const HintRequest = z.object({ itemId: z.string().max(200) })

export const AnswerFeedback = z.object({
  itemId: z.string(),
  attempt: z.number().int(),
  /** Immediate mode only (end mode: null until finish). */
  correct: z.boolean().nullable(),
  /** 0..1 partial credit; null when hidden or pending. */
  score: z.number().nullable(),
  /** Calm Swedish line. Never "fel". */
  message: z.string(),
  /** Next hint after a miss (immediate mode). */
  hint: z.string().optional(),
  /** The item is settled (solved, revealed or rated). */
  done: z.boolean(),
  revealed: z.boolean(),
  /** Correct answer in display form, when solved or revealed. */
  solution: z.string().optional(),
  explanation: z.string().optional(),
  /** Free text: advisory AI assessment (indices into the rubric). */
  ai: z.object({ keyPointsMet: z.array(z.number().int()), feedback: z.string(), score: z.number() }).optional(),
  /** Free text without AI: show the rubric and sample answer, resubmit with `selfRating`. */
  selfAssess: z.object({ rubric: z.array(z.string()), sampleAnswer: z.string().optional() }).optional(),
})
export type AnswerFeedback = z.infer<typeof AnswerFeedback>

export const HintResponse = z.object({ hint: z.string().nullable(), hintsShown: z.number().int(), more: z.boolean() })

export const RunSummary = z.object({
  answered: z.number().int(),
  total: z.number().int(),
  correct: z.number().int(),
  /** Non-punitive Swedish line, e.g. "Du klarade 7 av 10. Bra kämpat!" */
  message: z.string(),
  skills: z.array(
    z.object({
      skill: z.string(),
      /** Readable Swedish name of the skill (adaptive skillLabel); absent in older summaries. */
      label: z.string().optional(),
      correct: z.number().int(),
      total: z.number().int(),
      note: z.string(),
    }),
  ),
  /** Items worth another look (not solved first time, revealed or skipped). */
  review: z.array(
    z.object({
      itemId: z.string(),
      prompt: z.string(),
      solution: z.string().optional(),
      explanation: z.string().optional(),
    }),
  ),
  /** Free-text answers waiting for the learner's self-assessment (AI was unavailable). */
  selfAssess: z.array(
    z.object({
      itemId: z.string(),
      answer: z.string(),
      rubric: z.array(z.string()),
      sampleAnswer: z.string().optional(),
    }),
  ),
})
export type RunSummary = z.infer<typeof RunSummary>

export const RunState = z.enum(['active', 'finished', 'abandoned'])

/** GET run. While active, `items` carry no answers, hints, rubrics or explanations. */
export const RunView = z.object({
  id: z.string().uuid(),
  learnerId: z.string().uuid(),
  artifactId: z.string().uuid(),
  artifactVersion: z.number().int(),
  title: z.string(),
  mode: z.enum(['practice', 'test']),
  feedback: z.enum(['immediate', 'end']),
  state: RunState,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** Public item view while active (see publicItem), the full Item once finished. */
  items: z.array(z.record(z.string(), z.unknown())),
  /** Per item: attempts, hints shown, last saved answer and (immediate mode, or finished) last feedback. */
  progress: z.record(
    z.string(),
    z.object({
      attempts: z.number().int(),
      hintsShown: z.number().int(),
      done: z.boolean(),
      answer: z.unknown().optional(),
      feedback: AnswerFeedback.optional(),
    }),
  ),
  summary: RunSummary.nullable(),
})
export type RunView = z.infer<typeof RunView>
