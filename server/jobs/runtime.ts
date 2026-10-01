import { hostname } from 'node:os'
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import pg from 'pg'
import type { JobError, JobType } from '../../shared/contracts'
import type { Db } from '../db/client'
import { jobs, workerHeartbeats } from '../db/schema'
import {
  claim,
  complete,
  DEFAULT_JOBS_ENV,
  enqueue,
  failAttempt,
  JOBS_CHANNEL,
  progressWriter,
  pruneFinished,
  recoverStale,
  release,
  type JobRow,
} from './queue'

// Worker runtime: claim loop (LISTEN + polling fallback), handlers, heartbeats, scheduler.

const LEARNER_MESSAGE = 'Det gick inte att skapa uppgiften just nu.'

/** Thrown via `tools.fail(...)`; the only way a handler controls its JobError. */
export class JobFailure extends Error {
  readonly jobError: JobError
  constructor(code: string, adultMessage: string, retryable: boolean) {
    super(adultMessage)
    this.jobError = { code, learnerMessage: LEARNER_MESSAGE, adultMessage, retryable }
  }
}

/** Map anything thrown to a safe JobError: no stack traces or raw messages (they may carry secrets). */
export function toJobError(err: unknown, signal?: AbortSignal): JobError {
  if (err instanceof JobFailure) return err.jobError
  if (signal?.aborted && signal.reason === 'timeout')
    return {
      code: 'timeout',
      learnerMessage: LEARNER_MESSAGE,
      adultMessage: 'Uppgiften tog för lång tid och avbröts.',
      retryable: false,
    }
  const name = err instanceof Error && /^[A-Za-z]{1,40}$/.test(err.name) ? err.name : 'okänt'
  return {
    code: 'internal',
    learnerMessage: LEARNER_MESSAGE,
    adultMessage: `Ett internt fel uppstod (${name}).`,
    retryable: false,
  }
}

export interface JobTools {
  db: Db
  log: FastifyBaseLogger
  /** Aborted on timeout ('timeout'), cancel ('cancelled') or shutdown ('shutdown'); see `signal.reason`. */
  signal: AbortSignal
  /** Coarse progress 0..1 plus a short Swedish step text. Throttled. */
  progress(p: number, step?: string): Promise<void>
  fail(code: string, adultMessage: string, retryable: boolean): never
}

export interface JobHandler {
  type: JobType
  /** Returns the id of the produced entity, if any. */
  run(job: JobRow, tools: JobTools): Promise<string | void>
}

export function defineJobHandler(type: JobType, run: JobHandler['run']): JobHandler {
  return { type, run }
}

/** Subscribes to a NOTIFY channel; returns an unsubscribe function. */
export type Listener = (channel: string, onNotify: () => void) => Promise<() => Promise<void>>

/** LISTEN on a dedicated pg connection (the pool can't hold one). */
export function pgListener(databaseUrl: string, log?: FastifyBaseLogger): Listener {
  return async (channel, onNotify) => {
    const client = new pg.Client({ connectionString: databaseUrl })
    // ponytail: no reconnect; if this connection dies the polling fallback keeps jobs moving.
    client.on('error', (e) => log?.warn({ err: { name: e.name } }, 'job listener connection lost; polling only'))
    client.on('notification', (m) => m.channel === channel && onNotify())
    await client.connect()
    await client.query(`LISTEN ${channel}`)
    return () => client.end()
  }
}

/** A maintenance job enqueued every `everyMs` (deduped across workers per interval bucket). */
export interface Schedule {
  type: JobType
  everyMs: number
  payload?: Record<string, unknown>
}
export const DEFAULT_SCHEDULES: Schedule[] = [{ type: 'uploads.cleanup', everyMs: 3_600_000 }]

export interface WorkerOptions {
  db: Db
  log: FastifyBaseLogger
  handlers: JobHandler[]
  concurrency?: number
  workerId?: string
  /** Optional LISTEN wake-ups; without it the worker polls every `pollMs`. */
  listen?: Listener
  pollMs?: number
  heartbeatMs?: number
  /** A processing job whose heartbeat is older than this is recovered. */
  staleSeconds?: number
  timeoutSeconds?: number
  retentionDays?: number
  /** Only schedules whose type has a handler run. */
  schedules?: Schedule[]
}

export interface Worker {
  readonly workerId: string
  start(): Promise<void>
  /** Stop claiming, wait up to `graceMs` for running jobs, then release the rest back to the queue. */
  stop(graceMs?: number): Promise<void>
  /** Number of jobs currently running. */
  readonly active: number
}

export function createWorker(opts: WorkerOptions): Worker {
  const { db, log } = opts
  const workerId = opts.workerId ?? `${hostname()}-${process.pid}`
  const concurrency = opts.concurrency ?? DEFAULT_JOBS_ENV.WORKER_CONCURRENCY
  const pollMs = opts.pollMs ?? 5000
  const heartbeatMs = opts.heartbeatMs ?? 10_000
  const staleSeconds = opts.staleSeconds ?? 60
  const timeoutMs = (opts.timeoutSeconds ?? DEFAULT_JOBS_ENV.LIMIT_JOB_TIMEOUT_SECONDS) * 1000
  const handlers = new Map(opts.handlers.map((h) => [h.type, h]))
  const types = [...handlers.keys()]
  const schedules = (opts.schedules ?? DEFAULT_SCHEDULES).filter((s) => handlers.has(s.type))

  const running = new Map<string, { ctrl: AbortController; done: Promise<void> }>()
  let stopping = false
  let wake: () => void = () => {}
  let loopDone: Promise<void> = Promise.resolve()
  let unlisten: (() => Promise<void>) | undefined
  const timers: NodeJS.Timeout[] = []

  async function runJob(job: JobRow) {
    const ctrl = new AbortController()
    const jlog = log.child({ jobId: job.id, type: job.type })
    const timer = setTimeout(() => ctrl.abort('timeout'), timeoutMs)
    const aborted = new Promise<never>((_, reject) =>
      ctrl.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
    )
    aborted.catch(() => {})
    const tools: JobTools = {
      db,
      log: jlog,
      signal: ctrl.signal,
      progress: progressWriter(db, job.id, workerId),
      fail: (code, msg, retryable) => {
        throw new JobFailure(code, msg, retryable)
      },
    }
    const done = (async () => {
      try {
        const resultId = await Promise.race([handlers.get(job.type)!.run(job, tools), aborted])
        await complete(db, job.id, workerId, resultId || undefined)
        jlog.info('job completed')
      } catch (err) {
        const reason = ctrl.signal.aborted ? ctrl.signal.reason : undefined
        if (reason === 'shutdown') await release(db, job.id, workerId)
        else if (reason !== 'cancelled') {
          const e = toJobError(err, ctrl.signal)
          const retry = await failAttempt(db, job, workerId, e)
          jlog.warn({ code: e.code, retry, attempt: job.attempts }, 'job failed')
        }
      }
    })()
      .catch((e: Error) => jlog.error({ err: { name: e.name, message: e.message } }, 'job bookkeeping failed'))
      .finally(() => {
        clearTimeout(timer)
        running.delete(job.id)
        wake()
      })
    running.set(job.id, { ctrl, done })
  }

  async function loop() {
    while (!stopping) {
      try {
        while (!stopping && running.size < concurrency) {
          const job = await claim(db, workerId, types)
          if (!job) break
          await runJob(job)
        }
      } catch (e) {
        log.error({ err: { name: (e as Error).name, message: (e as Error).message } }, 'job claim failed')
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, pollMs)
        wake = () => (clearTimeout(t), resolve())
      })
    }
  }

  async function heartbeat() {
    await db
      .insert(workerHeartbeats)
      .values({ workerId, info: { concurrency, active: running.size, types } })
      .onConflictDoUpdate({
        target: workerHeartbeats.workerId,
        set: { beatAt: sql`now()`, info: { concurrency, active: running.size, types } },
      })
    const ids = [...running.keys()]
    if (!ids.length) return
    await db
      .update(jobs)
      .set({ heartbeatAt: sql`now()` })
      .where(and(inArray(jobs.id, ids), eq(jobs.lockedBy, workerId), eq(jobs.state, 'processing')))
    // Abort jobs that were cancelled or taken over meanwhile.
    const gone = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(inArray(jobs.id, ids), or(ne(jobs.state, 'processing'), ne(jobs.lockedBy, workerId))))
    for (const { id } of gone) running.get(id)?.ctrl.abort('cancelled')
  }

  const lastScheduled = new Map<JobType, number>()
  async function maintenance() {
    const recovered = await recoverStale(db, staleSeconds)
    if (recovered) log.warn({ recovered }, 'recovered stale jobs')
    await pruneFinished(db, opts.retentionDays)
    const now = Date.now()
    for (const s of schedules) {
      if (now - (lastScheduled.get(s.type) ?? 0) < s.everyMs) continue
      lastScheduled.set(s.type, now)
      const dedupeKey = `schedule:${s.type}:${Math.floor(now / s.everyMs)}`
      const [seen] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.dedupeKey, dedupeKey))
      if (!seen) await enqueue(db, { type: s.type, payload: s.payload ?? {}, dedupeKey })
    }
  }

  const every = (ms: number, fn: () => Promise<void>, name: string) => {
    const tick = () =>
      fn().catch((e: Error) => log.error({ err: { name: e.name, message: e.message } }, `${name} failed`))
    timers.push(setInterval(tick, ms))
    return tick()
  }

  return {
    workerId,
    get active() {
      return running.size
    },
    async start() {
      if (opts.listen) {
        try {
          unlisten = await opts.listen(JOBS_CHANNEL, () => wake())
        } catch (e) {
          log.warn({ err: { name: (e as Error).name } }, 'LISTEN unavailable; polling only')
        }
      }
      await every(heartbeatMs, heartbeat, 'heartbeat')
      await every(Math.max(heartbeatMs, 30_000), maintenance, 'maintenance')
      loopDone = loop()
      log.info({ workerId, concurrency, types }, 'worker started')
    },
    async stop(graceMs = 30_000) {
      stopping = true
      wake()
      timers.forEach(clearInterval)
      await loopDone
      const all = () => Promise.all([...running.values()].map((r) => r.done))
      let graceTimer: NodeJS.Timeout | undefined
      await Promise.race([all(), new Promise((r) => (graceTimer = setTimeout(r, graceMs)))])
      clearTimeout(graceTimer)
      for (const r of running.values()) r.ctrl.abort('shutdown')
      await all()
      await unlisten?.().catch(() => {})
      await db
        .delete(workerHeartbeats)
        .where(eq(workerHeartbeats.workerId, workerId))
        .catch(() => {})
      log.info({ workerId }, 'worker stopped')
    },
  }
}
