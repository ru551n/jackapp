import { z } from 'zod'

// Resource limits (docs/platform/env.md). All positive integers.
const n = (def: number) => z.coerce.number().int().positive().default(def)

export const LimitsEnv = z.object({
  LIMIT_AI_REQUESTS_PER_HOUR: n(2000),
  LIMIT_AI_CONCURRENCY: n(4),
  LIMIT_QUEUED_JOBS: n(500),
  LIMIT_JOB_TIMEOUT_SECONDS: n(1200),
  LIMIT_UPLOAD_FILE_MB: n(30),
  LIMIT_UPLOAD_TOTAL_MB: n(300),
  LIMIT_UPLOAD_PAGES: n(80),
  LIMIT_IMAGES_PER_DAY: n(300),
  WORKER_CONCURRENCY: n(2),
  UPLOAD_FAILED_RETENTION_HOURS: n(168),
})
export type LimitsEnv = z.infer<typeof LimitsEnv>
