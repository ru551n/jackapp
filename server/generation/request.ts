import { z } from 'zod'
import {
  ageBand,
  ArtifactType,
  SchoolPosition,
  SupportPreferences,
  type AgeBand,
  type GenerationRequest,
  type ItemKind,
  type LearnerProfileInput,
} from '../../shared/contracts'
import type { TextGeneration } from '../ai'
import { unsafeThemes } from '../learners/profile'
import { ITEM_KINDS } from './items'
import { interpretSystem } from './prompts'

// Request resolution: explicit form fields > interpreted free text > learner profile > age-band defaults.

/** Loose on purpose: anything out of range is clamped or dropped server-side, never trusted. */
export const Interpretation = z.object({
  type: z.string().optional(),
  subjectCode: z.string().optional(),
  stage: z.string().optional(),
  year: z.number().optional(),
  topic: z.string().optional(),
  questionCount: z.number().optional(),
  itemKinds: z.array(z.string()).optional(),
  difficulty: z.number().optional(),
  durationMinutes: z.number().optional(),
  theme: z.string().optional(),
  textAmount: z.string().optional(),
  visualSupport: z.string().optional(),
  maxChoices: z.number().optional(),
  stepByStep: z.boolean().optional(),
  feedback: z.string().optional(),
  hints: z.boolean().optional(),
})
export type Interpretation = z.infer<typeof Interpretation>

const clamp = (n: number | undefined, lo: number, hi: number) =>
  n === undefined || !Number.isFinite(n) ? undefined : Math.min(hi, Math.max(lo, Math.round(n)))
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]) =>
  allowed.includes(v as T) ? (v as T) : undefined
const text = (s: string | undefined, max: number) => s?.trim().slice(0, max) || undefined

/** Interpretation → request fields within the contract's enums and limits. */
export function clampInterpretation(i: Interpretation, subjectCodes: string[]): Partial<GenerationRequest> {
  const school =
    i.stage !== undefined && i.year !== undefined
      ? SchoolPosition.safeParse({ stage: i.stage, year: Math.round(i.year) })
      : undefined
  const support = {
    textAmount: oneOf(i.textAmount, ['minimal', 'reduced', 'normal'] as const),
    visualSupport: oneOf(i.visualSupport, ['high', 'normal', 'low'] as const),
    maxChoices: clamp(i.maxChoices, 2, 6),
    stepByStep: i.stepByStep,
  }
  const out: Partial<GenerationRequest> = {
    type: oneOf(i.type, ArtifactType.options),
    subjectCode: oneOf(i.subjectCode, subjectCodes),
    school: school?.success ? school.data : undefined,
    topic: text(i.topic, 300),
    questionCount: clamp(i.questionCount, 1, 60),
    itemKinds: i.itemKinds?.filter((k) => (ITEM_KINDS as readonly string[]).includes(k)).slice(0, 9),
    difficulty: clamp(i.difficulty, 1, 5),
    durationMinutes: clamp(i.durationMinutes, 3, 120),
    theme: text(i.theme, 100),
    feedback: oneOf(i.feedback, ['immediate', 'end'] as const),
    hints: i.hints,
  }
  if (out.itemKinds?.length === 0) delete out.itemKinds
  const sup = Object.fromEntries(Object.entries(support).filter(([, v]) => v !== undefined))
  if (Object.keys(sup).length) out.support = sup
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined))
}

/** Cheap structured call turning `instructions` into request fields. */
export async function interpretInstructions(
  ai: TextGeneration,
  instructions: string,
  subjects: { code: string; name: string }[],
  signal?: AbortSignal,
): Promise<Partial<GenerationRequest>> {
  const r = await ai.generate({
    system: interpretSystem(subjects),
    messages: [{ role: 'user', content: instructions }],
    schema: Interpretation,
    schemaName: 'request_fields',
    maxTokens: 600,
    temperature: 0,
    signal,
  })
  return clampInterpretation(
    r.output,
    subjects.map((s) => s.code),
  )
}

/** A fully resolved request: everything the engine needs is set. */
export type ResolvedRequest = GenerationRequest & {
  school: SchoolPosition
  support: SupportPreferences
  questionCount: number
  itemKinds: ItemKind[]
  difficulty: number
  durationMinutes: number
  /** Set by the job when web research ran; transforms reuse the brief (provenance view). */
  researchBriefId?: string
}

const PER_ITEM_MINUTES: Record<AgeBand, number> = { early: 1.5, middle: 2, upper: 2.5 }
const DEFAULT_COUNT: Record<AgeBand, number> = { early: 6, middle: 10, upper: 12 }

const DEFAULT_KINDS: Record<ArtifactType, ItemKind[]> = {
  practiceTest: ['multipleChoice', 'trueFalse', 'fillBlank', 'numeric', 'matching', 'freeText'],
  exercises: ['multipleChoice', 'fillBlank', 'numeric', 'ordering', 'matching', 'trueFalse'],
  lesson: ['multipleChoice', 'trueFalse', 'fillBlank', 'numeric'],
  revision: ['multipleChoice', 'flashcard', 'fillBlank', 'trueFalse'],
  worksheet: ['fillBlank', 'numeric', 'matching', 'freeText'],
  flashcards: ['flashcard'],
  readingComprehension: ['multipleChoice', 'trueFalse', 'freeText'],
  explanation: ['multipleChoice', 'trueFalse'],
  summary: ['multipleChoice', 'trueFalse'],
  story: ['multipleChoice', 'trueFalse'],
  writingPrompt: ['freeText'],
  project: ['freeText'],
}

/**
 * Merge explicit fields, interpreted fields and profile defaults. `explicit` lists the keys the
 * caller actually sent (zod defaults would otherwise look explicit).
 */
export function resolveRequest(
  req: GenerationRequest,
  explicit: string[],
  interpreted: Partial<GenerationRequest>,
  profile: LearnerProfileInput,
): ResolvedRequest {
  const given = new Set(explicit)
  const merged: GenerationRequest = { ...req }
  for (const [k, v] of Object.entries(interpreted))
    if (!given.has(k) && k !== 'support') (merged as Record<string, unknown>)[k] = v
  const support = SupportPreferences.parse({ ...profile.support, ...interpreted.support, ...req.support })
  const school = merged.school ?? profile.school
  const band = ageBand(school)

  const allowed = DEFAULT_KINDS[merged.type]
  let kinds = (merged.itemKinds ?? []).filter((k): k is ItemKind => (ITEM_KINDS as readonly string[]).includes(k))
  // Young learners don't get free writing outside writing tasks.
  if (!kinds.length)
    kinds =
      band === 'early' && merged.type !== 'writingPrompt' && merged.type !== 'project'
        ? allowed.filter((k) => k !== 'freeText')
        : allowed
  if (!kinds.length) kinds = allowed

  const duration = merged.durationMinutes ?? support.sessionMinutes
  const count =
    merged.questionCount ??
    (given.has('durationMinutes') || interpreted.durationMinutes
      ? Math.max(1, Math.min(60, Math.round(duration / PER_ITEM_MINUTES[band])))
      : DEFAULT_COUNT[band])

  let theme = merged.theme
  if (theme && unsafeThemes([theme]).length) theme = undefined
  return {
    ...merged,
    school,
    support,
    questionCount: count,
    itemKinds: kinds,
    difficulty:
      merged.difficulty ?? profile.subjectLevels.find((l) => l.subjectCode === merged.subjectCode)?.relativeLevel ?? 3,
    durationMinutes: duration,
    theme,
  }
}

/** Free text never carries the learner's name to the model. */
export function scrubRequest(r: GenerationRequest, name: string): GenerationRequest {
  const n = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!n) return r
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${n}(s?)(?![\\p{L}\\p{N}])`, 'giu')
  const s = (t?: string) => t?.replace(re, 'eleven$1')
  return { ...r, instructions: s(r.instructions), topic: s(r.topic), theme: s(r.theme) }
}
