import { z } from 'zod'
import { ApprovalState } from './content'

// Background jobs (Postgres-backed queue, executed by the worker service).

export const JobType = z.enum([
  'study.process',
  'artifact.generate',
  'artifact.regenerateItem',
  'image.generate',
  'research.run',
  'asset.fetch',
  'uploads.cleanup',
  'curriculum.sync',
  'path.plan',
])
export type JobType = z.infer<typeof JobType>

export const JobState = z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled'])
export type JobState = z.infer<typeof JobState>

/** Failure as shown to people: children see `learnerMessage`, adults see `adultMessage`. Never stack traces or secrets. */
export const JobError = z.object({
  /** Failure class, e.g. "ai_unavailable", "ai_invalid_output", "upload_unreadable", "limit_exceeded", "internal". */
  code: z.string(),
  learnerMessage: z.string().default('Det gick inte att skapa uppgiften just nu.'),
  adultMessage: z.string(),
  retryable: z.boolean(),
})
export type JobError = z.infer<typeof JobError>

export const JobStatus = z.object({
  id: z.string().uuid(),
  type: JobType,
  state: JobState,
  /** 0..1, coarse; plus a short Swedish step description. */
  progress: z.number().min(0).max(1),
  step: z.string().max(200).optional(),
  attempts: z.number().int().min(0),
  /** Id of the produced entity (artifact, study set, asset) when completed. */
  resultId: z.string().optional(),
  error: JobError.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type JobStatus = z.infer<typeof JobStatus>

/** Job types that create material for a learner (listed under "Pågår och klart"). */
export const CreationJobType = z.enum(['artifact.generate', 'artifact.regenerateItem', 'study.process'])
export type CreationJobType = z.infer<typeof CreationJobType>

/**
 * GET /learners/:id/jobs and GET /jobs (household, adult) — one entry per creation job. Never the raw payload: `title` is derived
 * (material title, instructions excerpt, type label or study set title). Learners get learnerMessage only.
 */
export const CreationJob = z.object({
  id: z.string().uuid(),
  type: CreationJobType,
  learnerId: z.string().uuid().optional(),
  state: JobState,
  progress: z.number().min(0).max(1),
  step: z.string().max(200).optional(),
  title: z.string().max(120),
  createdBy: z.enum(['adult', 'learner', 'system']).optional(),
  resultId: z.string().optional(),
  /** The material it made or changed (artifact jobs). */
  artifactId: z.string().uuid().optional(),
  /** The material's current approval, once it exists. */
  approval: ApprovalState.optional(),
  error: JobError.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type CreationJob = z.infer<typeof CreationJob>
