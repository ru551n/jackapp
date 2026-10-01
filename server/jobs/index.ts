import type { ReadinessCheck } from '../app/context'
import { parseEnv } from '../config/env'
import type { Db } from '../db/client'
import { jobsReadiness } from './health'
import * as q from './queue'

export * from './queue'
export * from './runtime'
export { checkWorkerHealth, jobsReadiness } from './health'
export { jobRoutes } from './routes'

/** Queue operations bound to the db and env limits; exposed as `ctx.jobs`. */
export interface JobsService {
  limits: q.JobsEnv
  readiness: ReadinessCheck[]
  enqueue(input: q.EnqueueInput): Promise<{ id: string; deduped: boolean }>
  getStatus: (id: string) => ReturnType<typeof q.getStatus>
  listForLearner: (learnerId: string, limit?: number) => ReturnType<typeof q.listForLearner>
  cancel: (id: string) => Promise<boolean>
  retryFailed: (id: string) => Promise<boolean>
}

export function jobsServices(ctx: { db: Db }, env: NodeJS.ProcessEnv = process.env): JobsService {
  const { db } = ctx
  const limits = parseEnv(q.JobsEnv, env)
  return {
    limits,
    readiness: jobsReadiness(db),
    enqueue: (input) => q.enqueue(db, input, limits),
    getStatus: (id) => q.getStatus(db, id),
    listForLearner: (id, limit) => q.listForLearner(db, id, limit),
    cancel: (id) => q.cancel(db, id),
    retryFailed: (id) => q.retryFailed(db, id),
  }
}

declare module '../app/context' {
  interface AppContext {
    /** Optional until server/main.ts and test helpers wire it; features fall back to `jobsServices(ctx)`. */
    jobs?: JobsService
  }
}
