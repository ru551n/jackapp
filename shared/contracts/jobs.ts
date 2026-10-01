import { z } from 'zod'

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
