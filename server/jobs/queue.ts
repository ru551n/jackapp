import { and, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { JobType, type JobError, type JobStatus } from '../../shared/contracts'
import type { Db } from '../db/client'
import { jobs, workerHeartbeats } from '../db/schema'
import { HttpError } from '../gate/guards'

// Postgres job queue: FOR UPDATE SKIP LOCKED claiming, NOTIFY wake-ups. See docs/platform/jobs.md.

export type JobRow = typeof jobs.$inferSelect
export const JOBS_CHANNEL = 'jackapp_jobs'
const ACTIVE = ['queued', 'processing'] as const

/** Job limits from env (docs/platform/env.md). */
export const JobsEnv = z.object({
  LIMIT_QUEUED_JOBS: z.coerce.number().int().positive().default(500),
  LIMIT_JOB_TIMEOUT_SECONDS: z.coerce.number().positive().default(1200),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
})
export type JobsEnv = z.infer<typeof JobsEnv>
export const DEFAULT_JOBS_ENV: JobsEnv = JobsEnv.parse({})

// Payload schemas per type. Unregistered types accept any JSON object.
const anyObject = z.record(z.string(), z.unknown())
const payloadSchemas = new Map<JobType, z.ZodType<Record<string, unknown>>>([['uploads.cleanup', z.object({})]])

/** Register the payload schema for a job type (call at module load in the feature's jobs module). */
export function registerJobPayload(type: JobType, schema: z.ZodType<Record<string, unknown>>) {
  payloadSchemas.set(type, schema)
}

export interface EnqueueInput {
  type: JobType
  payload: Record<string, unknown>
  learnerId?: string
  maxAttempts?: number
  dedupeKey?: string
  runAfter?: Date
}

/** Queue a job. With a `dedupeKey` already active, returns that job instead (`deduped: true`). */
export async function enqueue(
  db: Db,
  input: EnqueueInput,
  limits: Pick<JobsEnv, 'LIMIT_QUEUED_JOBS'> = DEFAULT_JOBS_ENV,
): Promise<{ id: string; deduped: boolean }> {
  const type = JobType.parse(input.type)
  const payload = (payloadSchemas.get(type) ?? anyObject).parse(input.payload)
  if (input.dedupeKey) {
    const existing = await activeByDedupeKey(db, input.dedupeKey)
    if (existing) return { id: existing.id, deduped: true }
  }
  // ponytail: count-then-insert is a soft limit (may overshoot by concurrent enqueues).
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(inArray(jobs.state, ACTIVE))) as [{ n: number }]
  if (n >= limits.LIMIT_QUEUED_JOBS)
    throw new HttpError(429, 'limit_exceeded', 'För många uppgifter i kö just nu. Försök igen senare.')
  const [row] = await db
    .insert(jobs)
    .values({
      type,
      payload,
      learnerId: input.learnerId,
      maxAttempts: input.maxAttempts ?? 3,
      dedupeKey: input.dedupeKey,
      runAfter: input.runAfter,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id })
  if (!row) {
    // Lost a dedupe race: the other insert won.
    const existing = await activeByDedupeKey(db, input.dedupeKey!)
    if (existing) return { id: existing.id, deduped: true }
    throw new Error('enqueue conflict')
  }
  await notify(db, type)
  return { id: row.id, deduped: false }
}

async function activeByDedupeKey(db: Db, key: string) {
  const [r] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.dedupeKey, key), inArray(jobs.state, ACTIVE)))
  return r
}

export async function notify(db: Db, payload = '') {
  await db.execute(sql`select pg_notify(${JOBS_CHANNEL}, ${payload})`)
}

export function toStatus(r: JobRow): JobStatus {
  return {
    id: r.id,
    type: r.type,
    state: r.state,
    progress: r.progress,
    step: r.step ?? undefined,
    attempts: r.attempts,
    resultId: r.resultId ?? undefined,
    error: r.state === 'failed' && r.lastError ? r.lastError : undefined,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

export async function getJob(db: Db, id: string): Promise<JobRow | undefined> {
  const [r] = await db.select().from(jobs).where(eq(jobs.id, id))
  return r
}

export async function getStatus(db: Db, id: string): Promise<JobStatus | undefined> {
  const r = await getJob(db, id)
  return r && toStatus(r)
}

export async function listForLearner(db: Db, learnerId: string, limit = 50): Promise<JobStatus[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.learnerId, learnerId))
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
  return rows.map(toStatus)
}

/** Cancel a queued or running job (adult action). A running handler is aborted at its next heartbeat. */
export async function cancel(db: Db, id: string): Promise<boolean> {
  const r = await db
    .update(jobs)
    .set({ state: 'cancelled', finishedAt: sql`now()`, updatedAt: sql`now()`, lockedBy: null })
    .where(and(eq(jobs.id, id), inArray(jobs.state, ACTIVE)))
    .returning({ id: jobs.id })
  return r.length > 0
}

/** Requeue a failed job with fresh attempts (adult action). */
export async function retryFailed(db: Db, id: string): Promise<boolean> {
  const r = await db
    .update(jobs)
    .set({
      state: 'queued',
      attempts: 0,
      lastError: null,
      progress: 0,
      step: null,
      runAfter: sql`now()`,
      finishedAt: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(jobs.id, id), eq(jobs.state, 'failed')))
    .returning({ type: jobs.type })
  if (r[0]) await notify(db, r[0].type)
  return r.length > 0
}

/** Atomically claim the next runnable job of the given types. */
export async function claim(db: Db, workerId: string, types: JobType[]): Promise<JobRow | undefined> {
  if (!types.length) return undefined
  const next = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.state, 'queued'), inArray(jobs.type, types), lte(jobs.runAfter, sql`now()`)))
    .orderBy(jobs.runAfter, jobs.createdAt)
    .limit(1)
    .for('update', { skipLocked: true })
  const [row] = await db
    .update(jobs)
    .set({
      state: 'processing',
      attempts: sql`${jobs.attempts} + 1`,
      lockedBy: workerId,
      lockedAt: sql`now()`,
      heartbeatAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(inArray(jobs.id, next))
    .returning()
  return row
}

const owned = (id: string, workerId: string) =>
  and(eq(jobs.id, id), eq(jobs.state, 'processing'), eq(jobs.lockedBy, workerId))
const unlock = { lockedBy: null, lockedAt: null, heartbeatAt: null, updatedAt: sql`now()` }

/** Mark a claimed job completed. False (no-op) if it was cancelled or taken over meanwhile. */
export async function complete(db: Db, id: string, workerId: string, resultId?: string): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ ...unlock, state: 'completed', progress: 1, resultId: resultId ?? null, finishedAt: sql`now()` })
    .where(owned(id, workerId))
    .returning({ id: jobs.id })
  return rows.length > 0
}

/** Exponential backoff with jitter: base·2^(attempt-1), capped, scaled by [0.5, 1). */
export function backoffMs(attempt: number, rand = Math.random, baseMs = 10_000, maxMs = 600_000) {
  return Math.round(Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs) * (0.5 + rand() / 2))
}

/** Record a failed attempt: requeue with backoff if retryable and attempts remain, else fail. */
export async function failAttempt(
  db: Db,
  job: JobRow,
  workerId: string,
  error: JobError,
  delayMs = backoffMs(job.attempts),
) {
  const retry = error.retryable && job.attempts < job.maxAttempts
  await db
    .update(jobs)
    .set(
      retry
        ? { ...unlock, state: 'queued', lastError: error, runAfter: sql`now() + ${delayMs} * interval '1 millisecond'` }
        : { ...unlock, state: 'failed', lastError: error, finishedAt: sql`now()` },
    )
    .where(owned(job.id, workerId))
  if (retry) await notify(db, job.type)
  return retry
}

/** Give a job back without counting the attempt (graceful shutdown). */
export async function release(db: Db, id: string, workerId: string) {
  await db
    .update(jobs)
    .set({ ...unlock, state: 'queued', attempts: sql`greatest(${jobs.attempts} - 1, 0)` })
    .where(owned(id, workerId))
}

/** Throttled to one write per `minIntervalMs` unless the step changes. */
export function progressWriter(db: Db, id: string, workerId: string, minIntervalMs = 1000) {
  let last = 0
  let lastStep: string | undefined
  return async (p: number, step?: string) => {
    const now = Date.now()
    if (now - last < minIntervalMs && step === lastStep) return
    last = now
    lastStep = step
    await db
      .update(jobs)
      .set({ progress: Math.min(1, Math.max(0, p)), step: step?.slice(0, 200) ?? null, updatedAt: sql`now()` })
      .where(owned(id, workerId))
  }
}

export const WORKER_LOST: JobError = {
  code: 'worker_lost',
  learnerMessage: 'Det gick inte att skapa uppgiften just nu.',
  adultMessage: 'Arbetsprocessen slutade svara mitt i uppgiften.',
  retryable: true,
}

/** Requeue (or fail, after maxAttempts) processing jobs whose heartbeat is older than `staleSeconds`. */
export async function recoverStale(db: Db, staleSeconds: number): Promise<number> {
  const stale = and(
    eq(jobs.state, 'processing'),
    lt(jobs.heartbeatAt, sql`now() - ${staleSeconds} * interval '1 second'`),
  )
  const requeued = await db
    .update(jobs)
    .set({ ...unlock, state: 'queued', lastError: WORKER_LOST, runAfter: sql`now()` })
    .where(and(stale, lt(jobs.attempts, jobs.maxAttempts)))
    .returning({ id: jobs.id })
  const failed = await db
    .update(jobs)
    .set({ ...unlock, state: 'failed', lastError: { ...WORKER_LOST, retryable: false }, finishedAt: sql`now()` })
    .where(stale)
    .returning({ id: jobs.id })
  if (requeued.length) await notify(db)
  return requeued.length + failed.length
}

/** Delete finished jobs and dead worker heartbeats older than the retention period. */
export async function pruneFinished(db: Db, retentionDays = 14) {
  const cutoff = sql`now() - ${retentionDays} * interval '1 day'`
  const r = await db
    .delete(jobs)
    .where(and(inArray(jobs.state, ['completed', 'failed', 'cancelled']), lt(jobs.finishedAt, cutoff)))
    .returning({ id: jobs.id })
  await db.delete(workerHeartbeats).where(lt(workerHeartbeats.beatAt, sql`now() - interval '1 day'`))
  return r.length
}
