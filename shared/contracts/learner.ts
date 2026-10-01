import { z } from 'zod'
import { SchoolPosition, SubjectCode } from './school'

// Functional learning needs only. Not medical or diagnostic data.

/** How material is presented — independent of how hard the concepts are. */
export const SupportPreferences = z.object({
  textAmount: z.enum(['minimal', 'reduced', 'normal']).default('normal'),
  visualSupport: z.enum(['high', 'normal', 'low']).default('normal'),
  /** Maximum simultaneous answer options. */
  maxChoices: z.number().int().min(2).max(6).default(4),
  readAloud: z.boolean().default(true),
  reducedMotion: z.boolean().default(false),
  /** Sound effects; speech is controlled by readAloud and is never automatic. */
  sound: z.boolean().default(false),
  stepByStep: z.boolean().default(false),
  repetition: z.enum(['low', 'normal', 'high']).default('normal'),
  pace: z.enum(['slow', 'normal', 'fast']).default('normal'),
  sessionMinutes: z.number().int().min(3).max(120).default(15),
  /** Longer thinking time / never any timers. Timers do not exist in JackApp; this only affects pacing hints. */
  extraThinkingTime: z.boolean().default(false),
  reducedVisualComplexity: z.boolean().default(false),
})
export type SupportPreferences = z.infer<typeof SupportPreferences>

/** Free-text descriptor per area, e.g. reading: "läser korta meningar". Levels are descriptive, not scores. */
export const SubjectLevel = z.object({
  subjectCode: SubjectCode,
  description: z.string().max(500),
  /** Optional rough position on a 1–5 scale relative to the learner's school year (3 = as expected). */
  relativeLevel: z.number().int().min(1).max(5).optional(),
})
export type SubjectLevel = z.infer<typeof SubjectLevel>

export const GenerationPolicy = z.object({
  /** Whether the learner may request material themselves. */
  learnerRequestsAllowed: z.boolean().default(true),
  /** immediate: validated material is usable at once; parent: waits for adult approval. */
  approval: z.enum(['immediate', 'parent']).default('immediate'),
})
export type GenerationPolicy = z.infer<typeof GenerationPolicy>

export const LearnerProfileInput = z.object({
  displayName: z.string().min(1).max(60),
  school: SchoolPosition,
  interests: z.array(z.string().max(60)).max(30).default([]),
  /** Themes the learner likes in material (may overlap interests). */
  themes: z.array(z.string().max(60)).max(30).default([]),
  strengths: z.array(z.string().max(200)).max(30).default([]),
  difficulties: z.array(z.string().max(200)).max(30).default([]),
  subjectLevels: z.array(SubjectLevel).max(40).default([]),
  /** Preferred language for UI and instructions. */
  language: z.enum(['sv']).default('sv'),
  support: SupportPreferences.default(SupportPreferences.parse({})),
  /** Early-years free play ("Bygg din linje"); off by default, enabled by an adult. */
  freePlayEnabled: z.boolean().default(false),
  generation: GenerationPolicy.default(GenerationPolicy.parse({})),
})
export type LearnerProfileInput = z.infer<typeof LearnerProfileInput>

export const LearnerProfile = LearnerProfileInput.extend({
  id: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type LearnerProfile = z.infer<typeof LearnerProfile>
