import { z } from 'zod'
import { SubjectCode } from './school'

// Evidence-based adaptivity. No fake precision: findings are qualitative with evidence counts.

/** One observed answer, recorded per skill tag of the item. */
export const SkillEvidence = z.object({
  learnerId: z.string().uuid(),
  skill: z.string().max(120),
  subjectCode: SubjectCode.optional(),
  artifactId: z.string().uuid().optional(),
  itemId: z.string().optional(),
  correct: z.boolean(),
  /** Attempts before correct (0 = first try), hints used, whether the answer was revealed. */
  misses: z.number().int().min(0),
  hintsUsed: z.number().int().min(0),
  difficulty: z.number().int().min(1).max(5),
  at: z.string(),
})
export type SkillEvidence = z.infer<typeof SkillEvidence>

export const SkillStatus = z.enum(['new', 'practising', 'secure', 'needsSupport'])
export type SkillStatus = z.infer<typeof SkillStatus>

export const SkillSummary = z.object({
  skill: z.string(),
  subjectCode: SubjectCode.optional(),
  status: SkillStatus,
  evidenceCount: z.number().int().min(0),
  /** Swedish, qualitative: "Verkar behöva mer träning på tiotalsövergångar." */
  note: z.string().max(300).optional(),
  lastPracticedAt: z.string().optional(),
})
export type SkillSummary = z.infer<typeof SkillSummary>

export const MilestoneStatus = z.enum(['upcoming', 'active', 'done'])

export const LearningPath = z.object({
  id: z.string().uuid(),
  learnerId: z.string().uuid(),
  goal: z.string().max(300),
  subjectCode: SubjectCode.optional(),
  /** Optional target date (e.g. a test). */
  targetDate: z.string().optional(),
  milestones: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().max(200),
        skills: z.array(z.string()).max(10),
        status: MilestoneStatus,
        /** Generated lazily when the milestone becomes active (no bulk pre-generation). */
        artifactIds: z.array(z.string().uuid()).default([]),
      }),
    )
    .min(1)
    .max(30),
  /** Spaced review: skills due for review and when. */
  reviews: z.array(z.object({ skill: z.string(), dueAt: z.string() })).default([]),
  status: z.enum(['active', 'paused', 'completed']),
  createdAt: z.string(),
})
export type LearningPath = z.infer<typeof LearningPath>
