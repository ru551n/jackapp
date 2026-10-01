import { hostname } from 'node:os'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import pg from 'pg'
import type { JobError, JobType } from '../../shared/contracts'
import { safeErr, type Db } from '../db/client'
import { jobs, workerHeartbeats } from '../db/schema'
import {
  claim,
  complete,
  DEFAULT_JOBS_ENV,
  enqueue,
  backoffMs,
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
  /** Earliest retry (e.g. a provider's Retry-After); the requeue waits at least this long. */
  readonly retryAfterMs?: number
  constructor(code: string, adultMessage: string, retryable: boolean, retryAfterMs?: number) {
    super(adultMessage)
    this.jobError = { code, learnerMessage: LEARNER_MESSAGE, adultMessage, retryable }
    this.retryAfterMs = retryAfterMs
  }
}

/** `retryAfterMs` of anything thrown (JobFailure, AiError, or their `.cause`), if any. */
export function retryAfterOf(err: unknown): number {
  for (
    let c = err as { retryAfterMs?: unknown; cause?: unknown } | undefined, i = 0;
    c && i < 5;
    c = c.cause as typeof c, i++
  )
    if (typeof c.retryAfterMs === 'number' && c.retryAfterMs > 0) return c.retryAfterMs
  return 0
}

/** Map anything thrown to a safe JobError: no stack traces or raw messages (they may carry secrets). */
export function toJobError(err: unknown, signal?: AbortSignal, opts: { timeoutRetryable?: boolean } = {}): JobError {
  if (err instanceof JobFailure) return err.jobError
  if (signal?.aborted && signal.reason === 'timeout')
    return {
      code: 'timeout',
      learnerMessage: LEARNER_MESSAGE,
      adultMessage: 'Uppgiften tog för lång tid och avbröts.',
      retryable: opts.timeoutRetryable ?? false,
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
  fail(code: string, adultMessage: string, retryable: boolean, retryAfterMs?: number): never
  /**
   * Call right before a job's final writes, inside their transaction: throws if the job was
   * aborted, cancelled, deleted or taken over. Locks the job row, so a concurrent cancel waits.
   */
  assertActive?(tx?: Db): Promise<void>
}

export interface JobHandler {
  type: JobType
  /** Returns the id of the produced entity, if any. */
  run(job: JobRow, tools: JobTools): Promise<string | void>
  /**
   * Completion hook: part of the job, after `run` succeeds and before the job is marked completed,
   * so it runs at least once (a crash re-runs the job). Must be idempotent. A throw fails the
   * attempt as retryable. Composed in server/worker/handlers.ts so domains don't import each other.
   */
  onCompleted?(job: JobRow, resultId: string | undefined, tools: Pick<JobTools, 'db' | 'log'>): Promise<void>
  /** Per-job timeout (default: the worker's `timeoutSeconds`). */
  timeoutMs?(job: JobRow, db: Db): Promise<number>
  /** Requeue on timeout (while attempts remain), e.g. when the handler keeps its progress. */
  retryOnTimeout?: boolean
}

export function defineJobHandler(type: JobType, run: JobHandler['run']): JobHandler {
  return { type, run }
}

/** Subscribes to a NOTIFY channel; returns an unsubscribe function. */
export type Listener = (channel: string, onNotify: () => void) => Promise<() => Promise<void>>

type ListenClient = Pick<pg.Client, 'connect' | 'query' | 'end' | 'on'>

/**
 * LISTEN on a dedicated pg connection (the pool can't hold one). A lost connection reconnects with
 * exponential backoff (polling keeps jobs moving meanwhile); each (re)connect wakes the worker once.
 */
export function pgListener(
  databaseUrl: string,
  log?: Pick<FastifyBaseLogger, 'warn'>,
  opts: { minMs?: number; maxMs?: number; client?: () => ListenClient } = {},
): Listener {
  const { minMs = 1000, maxMs = 30_000 } = opts
  const newClient = opts.client ?? (() => new pg.Client({ connectionString: databaseUrl }))
  return async (channel, onNotify) => {
    let closed = false
    let current: ListenClient | undefined
    let timer: NodeJS.Timeout | undefined
    let delay = minMs
    const connect = async () => {
      const c = newClient()
      let dropped = false
      const drop = (e?: Error) => {
        if (dropped) return
        dropped = true
        c.end().catch(() => {})
        if (closed) return
        log?.warn(
          { err: e ? safeErr(e) : { name: 'end' }, retryMs: delay },
          'job listener connection lost; reconnecting',
        )
        timer = setTimeout(() => void connect().catch(() => {}), delay)
        delay = Math.min(delay * 2, maxMs)
      }
      c.on('error', drop)
      c.on('end', () => drop())
      c.on('notification', (m: pg.Notification) => m.channel === channel && onNotify())
      try {
        await c.connect()
        await c.query(`LISTEN ${channel}`)
      } catch (e) {
        drop(e as Error)
        throw e
      }
      current = c
      delay = minMs
      onNotify() // catch up on anything sent while disconnected
    }
    await connect()
    return async () => {
      closed = true
      clearTimeout(timer)
      await current?.end()
    }
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
  /** Called after each successful DB heartbeat (the container healthcheck's liveness file). */
  onHeartbeat?: () => void
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
  // A wake that arrives mid-claim is remembered, so the loop claims again instead of sleeping.
  let pendingWake = false
  let resolveWait: (() => void) | undefined
  const wake = () => {
    pendingWake = true
    resolveWait?.()
  }
  let loopDone: Promise<void> = Promise.resolve()
  let unlisten: (() => Promise<void>) | undefined
  const timers: NodeJS.Timeout[] = []

  async function runJob(job: JobRow) {
    const ctrl = new AbortController()
    const jlog = log.child({ jobId: job.id, type: job.type })
    const handler = handlers.get(job.type)!
    const ms = handler.timeoutMs ? await handler.timeoutMs(job, db).catch(() => timeoutMs) : timeoutMs
    const timer = setTimeout(() => ctrl.abort('timeout'), ms)
    const aborted = new Promise<never>((_, reject) =>
      ctrl.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
    )
    aborted.catch(() => {})
    const tools: JobTools = {
      db,
      log: jlog,
      signal: ctrl.signal,
      progress: progressWriter(db, job.id, workerId),
      fail: (code, msg, retryable, retryAfterMs) => {
        throw new JobFailure(code, msg, retryable, retryAfterMs)
      },
      assertActive: async (tx = db) => {
        ctrl.signal.throwIfAborted()
        const [row] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.id, job.id), eq(jobs.state, 'processing'), eq(jobs.lockedBy, workerId)))
          .for('update')
        if (!row) {
          ctrl.abort('cancelled')
          ctrl.signal.throwIfAborted()
        }
      },
    }
    const done = (async () => {
      try {
        const resultId = (await Promise.race([handler.run(job, tools), aborted])) || undefined
        if (handler.onCompleted) {
          ctrl.signal.throwIfAborted()
          await handler.onCompleted(job, resultId, tools).catch((e: unknown) => {
            jlog.error({ err: safeErr(e) }, 'completion hook failed')
            throw new JobFailure('completion_failed', 'Resultatet kunde inte sparas. Försöker igen.', true)
          })
        }
        if (!(await complete(db, job.id, workerId, resultId))) return
        jlog.info('job completed')
      } catch (err) {
        const reason = ctrl.signal.aborted ? ctrl.signal.reason : undefined
        if (reason === 'shutdown') await release(db, job.id, workerId)
        else if (reason !== 'cancelled') {
          const e = toJobError(err, ctrl.signal, { timeoutRetryable: handler.retryOnTimeout })
          const delay = Math.max(backoffMs(job.attempts), retryAfterOf(err))
          const retry = await failAttempt(db, job, workerId, e, delay)
          jlog.warn({ code: e.code, retry, attempt: job.attempts, delayMs: retry ? delay : undefined }, 'job failed')
        }
      }
    })()
      .catch((e: unknown) => jlog.error({ err: safeErr(e) }, 'job bookkeeping failed'))
      .finally(() => {
        clearTimeout(timer)
        running.delete(job.id)
        wake()
      })
    running.set(job.id, { ctrl, done })
  }

  async function loop() {
    while (!stopping) {
      pendingWake = false
      try {
        while (!stopping && running.size < concurrency) {
          const job = await claim(db, workerId, types)
          if (!job) break
          await runJob(job)
        }
      } catch (e) {
        log.error({ err: safeErr(e) }, 'job claim failed')
      }
      if (pendingWake || stopping) continue
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, pollMs)
        resolveWait = () => (clearTimeout(t), resolve())
      })
      resolveWait = undefined
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
    if (ids.length) {
      const owned = await db
        .update(jobs)
        .set({ heartbeatAt: sql`now()` })
        .where(and(inArray(jobs.id, ids), eq(jobs.lockedBy, workerId), eq(jobs.state, 'processing')))
        .returning({ id: jobs.id })
      // Abort jobs that were cancelled, deleted (e.g. learner cascade) or taken over meanwhile.
      const still = new Set(owned.map((r) => r.id))
      for (const id of ids) if (!still.has(id)) running.get(id)?.ctrl.abort('cancelled')
    }
    opts.onHeartbeat?.()
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
    const tick = () => fn().catch((e: unknown) => log.error({ err: safeErr(e) }, `${name} failed`))
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
