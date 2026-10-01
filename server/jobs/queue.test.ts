import { eq, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type Db } from '../db/client'
import { jobs } from '../db/schema'
import { seedLearner } from '../test/helpers'
import '../worker/handlers' // every domain's registerJobPayload
import { checkWorkerHealth, jobsReadiness } from './health'
import {
  backoffMs,
  cancel,
  claim,
  complete,
  enqueue,
  failAttempt,
  getJob,
  getStatus,
  listForLearner,
  pruneFinished,
  recoverStale,
  retryFailed,
} from './queue'
import {
  createWorker,
  defineJobHandler,
  JobFailure,
  pgListener,
  retryAfterOf,
  toJobError,
  type JobHandler,
  type Worker,
} from './runtime'
import { JOBS_CHANNEL } from './queue'

const noop = () => {}
const testLog = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  trace: noop,
  fatal: noop,
} as unknown as FastifyBaseLogger
testLog.child = () => testLog

async function until(fn: () => Promise<boolean> | boolean, ms = 5000) {
  const end = Date.now() + ms
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 20))
  }
}

let db: Db
let close: () => Promise<void>
let worker: Worker | undefined
beforeEach(async () => ({ db, close } = await createTestDb()))
afterEach(async () => {
  await worker?.stop(100)
  worker = undefined
  await close()
})

const state = async (id: string) => (await getJob(db, id))!.state
const startWorker = async (handlers: JobHandler[], extra: Partial<Parameters<typeof createWorker>[0]> = {}) => {
  // No maintenance schedules unless a test asks: they would add uploads.cleanup jobs.
  const opts = { db, log: testLog, handlers, workerId: 'test-1', pollMs: 20, heartbeatMs: 50, schedules: [], ...extra }
  worker = createWorker(opts)
  await worker.start()
  return worker
}

describe('queue', () => {
  it('enqueues, claims and completes', async () => {
    const l = await seedLearner(db)
    const { id } = await enqueue(db, { type: 'curriculum.sync', payload: { a: 1 }, learnerId: l.id })
    expect(await claim(db, 'w', ['uploads.cleanup'])).toBeUndefined()
    const job = await claim(db, 'w', ['curriculum.sync'])
    expect(job).toMatchObject({ id, state: 'processing', attempts: 1, lockedBy: 'w', payload: { a: 1 } })
    expect(await claim(db, 'w', ['curriculum.sync'])).toBeUndefined()
    await complete(db, id, 'w', 'res-1')
    expect(await getStatus(db, id)).toMatchObject({ state: 'completed', progress: 1, resultId: 'res-1', attempts: 1 })
    expect(await listForLearner(db, l.id)).toHaveLength(1)
  })

  it('validates payloads against the registry', async () => {
    await expect(enqueue(db, { type: 'uploads.cleanup', payload: { x: 1 } as never })).resolves.toBeTruthy()
    await expect(enqueue(db, { type: 'nope' as never, payload: {} })).rejects.toThrow()
    // Domain modules register real schemas (loaded via the app's route registry).
    for (const type of [
      'artifact.generate',
      'artifact.regenerateItem',
      'image.generate',
      'research.run',
      'asset.fetch',
      'path.plan',
      'study.process',
    ] as const)
      await expect(enqueue(db, { type, payload: {} }), type).rejects.toThrow()
  })

  it('never double-claims under parallel claimers', async () => {
    for (let i = 0; i < 10; i++) await enqueue(db, { type: 'curriculum.sync', payload: { i } })
    const got = await Promise.all(Array.from({ length: 25 }, (_, i) => claim(db, `w${i}`, ['curriculum.sync'])))
    const ids = got.filter(Boolean).map((j) => j!.id)
    expect(ids).toHaveLength(10)
    expect(new Set(ids).size).toBe(10)
  })

  it('retries retryable errors with backoff; fails non-retryable and after maxAttempts', async () => {
    expect(backoffMs(1, () => 0)).toBe(5000)
    expect(backoffMs(3, () => 0.999)).toBeLessThanOrEqual(40_000)
    expect(backoffMs(30, () => 0)).toBe(300_000)

    const { id } = await enqueue(db, { type: 'uploads.cleanup', payload: {}, maxAttempts: 2 })
    const err = { code: 'ai_unavailable', learnerMessage: 'x', adultMessage: 'y', retryable: true }
    expect(await failAttempt(db, (await claim(db, 'w', ['uploads.cleanup']))!, 'w', err, 60_000)).toBe(true)
    expect(await state(id)).toBe('queued')
    expect(await claim(db, 'w', ['uploads.cleanup'])).toBeUndefined() // backoff not elapsed
    await db
      .update(jobs)
      .set({ runAfter: sql`now()` })
      .where(eq(jobs.id, id))
    expect(await failAttempt(db, (await claim(db, 'w', ['uploads.cleanup']))!, 'w', err, 0)).toBe(false)
    expect(await getStatus(db, id)).toMatchObject({ state: 'failed', attempts: 2, error: { code: 'ai_unavailable' } })

    const b = await enqueue(db, { type: 'uploads.cleanup', payload: {} })
    await failAttempt(db, (await claim(db, 'w', ['uploads.cleanup']))!, 'w', { ...err, retryable: false })
    expect(await state(b.id)).toBe('failed')
    expect(await retryFailed(db, b.id)).toBe(true)
    expect(await getStatus(db, b.id)).toMatchObject({ state: 'queued', attempts: 0, error: undefined })
  })

  it('recovers stale locks: requeue, or fail after maxAttempts', async () => {
    const a = await enqueue(db, { type: 'uploads.cleanup', payload: {}, maxAttempts: 2 })
    const b = await enqueue(db, { type: 'uploads.cleanup', payload: {}, maxAttempts: 1 })
    await claim(db, 'dead', ['uploads.cleanup'])
    await claim(db, 'dead', ['uploads.cleanup'])
    expect(await recoverStale(db, 60)).toBe(0)
    await db.update(jobs).set({ heartbeatAt: sql`now() - interval '5 minutes'` })
    expect(await recoverStale(db, 60)).toBe(2)
    expect(await getJob(db, a.id)).toMatchObject({
      state: 'queued',
      lockedBy: null,
      lastError: { code: 'worker_lost' },
    })
    expect(await getStatus(db, b.id)).toMatchObject({ state: 'failed', error: { code: 'worker_lost' } })
  })

  it('cancels queued and processing jobs; completion after cancel is a no-op', async () => {
    const a = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    expect(await cancel(db, a.id)).toBe(true)
    expect(await claim(db, 'w', ['curriculum.sync'])).toBeUndefined()
    const b = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    await claim(db, 'w', ['curriculum.sync'])
    expect(await cancel(db, b.id)).toBe(true)
    await complete(db, b.id, 'w', 'r')
    expect(await state(b.id)).toBe('cancelled')
    expect(await cancel(db, b.id)).toBe(false)
  })

  it('enforces the queued-jobs limit', async () => {
    const lim = { LIMIT_QUEUED_JOBS: 2 }
    await enqueue(db, { type: 'curriculum.sync', payload: {} }, lim)
    await enqueue(db, { type: 'curriculum.sync', payload: {} }, lim)
    await expect(enqueue(db, { type: 'curriculum.sync', payload: {} }, lim)).rejects.toMatchObject({
      status: 429,
      code: 'limit_exceeded',
    })
  })

  it('dedupes active jobs by dedupeKey', async () => {
    const a = await enqueue(db, { type: 'curriculum.sync', payload: {}, dedupeKey: 'k' })
    const b = await enqueue(db, { type: 'curriculum.sync', payload: {}, dedupeKey: 'k' })
    expect(b).toEqual({ id: a.id, deduped: true })
    await cancel(db, a.id)
    const c = await enqueue(db, { type: 'curriculum.sync', payload: {}, dedupeKey: 'k' })
    expect(c.deduped).toBe(false)
    expect(c.id).not.toBe(a.id)
    // Racing enqueues hit the partial unique index and still converge on one job.
    const [d, e] = await Promise.all(
      [1, 2].map(() => enqueue(db, { type: 'curriculum.sync', payload: {}, dedupeKey: 'race' })),
    )
    expect(d!.id).toBe(e!.id)
  })

  it('prunes finished jobs past retention', async () => {
    const a = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    await cancel(db, a.id)
    expect(await pruneFinished(db, 14)).toBe(0)
    await db.update(jobs).set({ finishedAt: sql`now() - interval '30 days'` })
    expect(await pruneFinished(db, 14)).toBe(1)
  })
})

describe('worker runtime', () => {
  it('runs handlers with progress and completes', async () => {
    const seen: number[] = []
    await startWorker([
      defineJobHandler('curriculum.sync', async (job, t) => {
        await t.progress(0.5, 'Skriver uppgifter')
        seen.push((await getJob(t.db, job.id))!.progress)
        await t.progress(0.6, 'Skriver uppgifter') // throttled
        seen.push((await getJob(t.db, job.id))!.progress)
        return 'artifact-9'
      }),
    ])
    const { id } = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    await until(async () => (await state(id)) === 'completed')
    expect(seen).toEqual([0.5, 0.5])
    expect((await getStatus(db, id))!.resultId).toBe('artifact-9')
  })

  it('runs onCompleted as part of the job (before completion); a hook failure is retried', async () => {
    const seen: [string, string | undefined, string][] = []
    let breakHook = true
    await startWorker([
      {
        ...defineJobHandler('curriculum.sync', async (job) =>
          (job.payload as { fail?: boolean }).fail ? Promise.reject(new Error('x')) : 'r-1',
        ),
        onCompleted: async (job, resultId, t) => {
          seen.push([job.id, resultId, (await getJob(t.db, job.id))!.state])
          if (breakHook) throw new Error('hook broke')
        },
      },
    ])
    const ok = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    const bad = await enqueue(db, { type: 'curriculum.sync', payload: { fail: true } })
    await until(async () => (await state(bad.id)) === 'failed' && seen.length === 1)
    await until(async () => (await state(ok.id)) === 'queued')
    expect(await getJob(db, ok.id)).toMatchObject({ lastError: { code: 'completion_failed', retryable: true } })
    breakHook = false
    await db
      .update(jobs)
      .set({ runAfter: sql`now()` })
      .where(eq(jobs.id, ok.id))
    await until(async () => (await state(ok.id)) === 'completed')
    expect(seen).toEqual([
      [ok.id, 'r-1', 'processing'],
      [ok.id, 'r-1', 'processing'],
    ])
    expect(await getStatus(db, ok.id)).toMatchObject({ state: 'completed', resultId: 'r-1' })
  })

  it("requeues a retryable error no sooner than the error's retryAfterMs", async () => {
    const aiLike = Object.assign(new Error('rate limited'), { name: 'AiError', retryAfterMs: 3_600_000 })
    await startWorker([
      defineJobHandler('curriculum.sync', async () => {
        throw Object.assign(new JobFailure('ai_rate_limited', 'Överbelastad.', true), { cause: aiLike })
      }),
      defineJobHandler('uploads.cleanup', async () => {
        throw new JobFailure('ai_rate_limited', 'Överbelastad.', true, 7_200_000)
      }),
    ])
    const a = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    const b = await enqueue(db, { type: 'uploads.cleanup', payload: {} })
    await until(async () => (await state(a.id)) === 'queued' && (await getJob(db, a.id))!.attempts === 1)
    await until(async () => (await state(b.id)) === 'queued' && (await getJob(db, b.id))!.attempts === 1)
    const after = async (id: string) => (await getJob(db, id))!.runAfter.getTime() - Date.now()
    expect(await after(a.id)).toBeGreaterThan(3_590_000)
    expect(await after(b.id)).toBeGreaterThan(7_190_000)
    expect(retryAfterOf(aiLike)).toBe(3_600_000)
  })

  it('aborts a running job whose row was deleted (e.g. learner cascade)', async () => {
    let reason: unknown
    await startWorker([
      defineJobHandler(
        'curriculum.sync',
        (_j, t) =>
          new Promise((_, rej) =>
            t.signal.addEventListener('abort', () => ((reason = t.signal.reason), rej(new Error()))),
          ),
      ),
    ])
    const { id } = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    await until(async () => (await state(id)) === 'processing')
    await db.delete(jobs).where(eq(jobs.id, id))
    await until(() => reason !== undefined)
    expect(reason).toBe('cancelled')
  })

  it('assertActive throws once the job is cancelled, so final writes are skipped', async () => {
    let wrote = false
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await startWorker(
      [
        defineJobHandler('curriculum.sync', async (_j, t) => {
          await gate
          await t.db.transaction(async (tx) => {
            await t.assertActive!(tx as unknown as Db)
            wrote = true
          })
        }),
      ],
      { heartbeatMs: 60_000 },
    )
    const { id } = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    await until(async () => (await state(id)) === 'processing')
    await cancel(db, id)
    release()
    await until(() => worker!.active === 0)
    expect(wrote).toBe(false)
    expect(await state(id)).toBe('cancelled')
  })

  it('per-type timeout; a retryOnTimeout handler is requeued after a timeout', async () => {
    await startWorker(
      [
        {
          ...defineJobHandler(
            'curriculum.sync',
            (_j, t) => new Promise((_, rej) => t.signal.addEventListener('abort', () => rej(new Error()))),
          ),
          timeoutMs: async () => 50,
          retryOnTimeout: true,
        },
      ],
      { timeoutSeconds: 3600 },
    )
    const { id } = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    await until(async () => (await getJob(db, id))!.lastError !== null)
    expect(await getJob(db, id)).toMatchObject({ state: 'queued', lastError: { code: 'timeout', retryable: true } })
  })

  it('never logs messages of failing queries (they carry SQL params)', async () => {
    const lines: unknown[] = []
    const log = { ...testLog, error: (o: unknown) => lines.push(o), warn: (o: unknown) => lines.push(o) }
    log.child = () => log as unknown as FastifyBaseLogger
    await startWorker(
      [
        {
          ...defineJobHandler('curriculum.sync', async () => 'r'),
          onCompleted: async (_j, _r, t) => void (await t.db.execute(sql`select ${'Jacks hemliga svar'}::int`)),
        },
      ],
      { log: log as unknown as FastifyBaseLogger },
    )
    const { id } = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    await until(async () => (await getJob(db, id))!.lastError !== null)
    expect(JSON.stringify(lines)).toContain('22P02')
    expect(JSON.stringify(lines)).not.toMatch(/hemliga|select/)
  })

  it('heartbeat reports to onHeartbeat only after a successful DB write', async () => {
    let beats = 0
    await startWorker([], { onHeartbeat: () => beats++ })
    expect(beats).toBe(1)
  })

  it('pgListener reconnects with backoff and wakes on each (re)connect', async () => {
    const { EventEmitter } = await import('node:events')
    const clients: InstanceType<typeof EventEmitter>[] = []
    let failNext = 0
    const client = () => {
      const c = Object.assign(new EventEmitter(), {
        connect: async () => {
          if (failNext > 0 && failNext--) throw new Error('down')
        },
        query: async () => ({}),
        end: async () => {},
      })
      clients.push(c)
      return c as never
    }
    let wakes = 0
    const listen = pgListener('postgres://x', undefined, { minMs: 10, maxMs: 40, client })
    const stop = await listen(JOBS_CHANNEL, () => wakes++)
    expect(wakes).toBe(1)
    failNext = 2
    clients[0]!.emit('error', new Error('terminated'))
    await until(() => wakes === 2) // two failed reconnects, then success
    expect(clients).toHaveLength(4)
    clients[3]!.emit('notification', { channel: JOBS_CHANNEL })
    expect(wakes).toBe(3)
    await stop()
    clients[3]!.emit('end')
    await new Promise((r) => setTimeout(r, 60))
    expect(clients).toHaveLength(4) // no reconnect after unsubscribe
  })

  it('runs up to `concurrency` jobs in parallel', async () => {
    let peak = 0
    let now = 0
    await startWorker(
      [
        defineJobHandler('uploads.cleanup', async () => {
          peak = Math.max(peak, ++now)
          await new Promise((r) => setTimeout(r, 100))
          now--
        }),
      ],
      { concurrency: 3 },
    )
    const ids = await Promise.all(
      Array.from({ length: 6 }, () => enqueue(db, { type: 'uploads.cleanup', payload: {} })),
    )
    await until(async () => (await Promise.all(ids.map((j) => state(j.id)))).every((s) => s === 'completed'))
    expect(peak).toBe(3)
  })

  it('times out handlers via AbortSignal', async () => {
    let aborted: unknown
    await startWorker(
      [
        defineJobHandler('curriculum.sync', (_j, t) => {
          return new Promise((_, rej) =>
            t.signal.addEventListener('abort', () => ((aborted = t.signal.reason), rej(new Error('x')))),
          )
        }),
      ],
      { timeoutSeconds: 0.1 },
    )
    const { id } = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    await until(async () => (await state(id)) === 'failed')
    expect(aborted).toBe('timeout')
    expect((await getStatus(db, id))!.error).toMatchObject({ code: 'timeout', retryable: false })
  })

  it('aborts a running job when it is cancelled', async () => {
    let reason: unknown
    await startWorker([
      defineJobHandler(
        'curriculum.sync',
        (_j, t) =>
          new Promise((_, rej) =>
            t.signal.addEventListener('abort', () => ((reason = t.signal.reason), rej(new Error()))),
          ),
      ),
    ])
    const { id } = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    await until(async () => (await state(id)) === 'processing')
    await cancel(db, id)
    await until(() => reason !== undefined)
    expect(reason).toBe('cancelled')
    await until(() => worker!.active === 0)
    expect(await state(id)).toBe('cancelled')
  })

  it('maps tools.fail and unknown errors to safe JobErrors (no stacks, no secrets)', async () => {
    const secret = 'sk-live-SECRET123 at https://user:pw@host/v1'
    await startWorker([
      defineJobHandler('curriculum.sync', async (_j, t) =>
        t.fail('upload_unreadable', 'Filen kunde inte läsas.', false),
      ),
      defineJobHandler('uploads.cleanup', async () => {
        throw new Error(secret)
      }),
    ])
    const a = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    const b = await enqueue(db, { type: 'uploads.cleanup', payload: {} })
    await until(async () => (await state(a.id)) === 'failed' && (await state(b.id)) === 'failed')
    expect((await getStatus(db, a.id))!.error).toEqual({
      code: 'upload_unreadable',
      learnerMessage: 'Det gick inte att skapa uppgiften just nu.',
      adultMessage: 'Filen kunde inte läsas.',
      retryable: false,
    })
    const e = (await getStatus(db, b.id))!.error!
    expect(e.code).toBe('internal')
    expect(JSON.stringify(e)).not.toMatch(/SECRET|sk-live|https|pw@|\n\s+at /)
    const weird = Object.assign(new Error(secret), { name: secret })
    expect(JSON.stringify(toJobError(weird))).not.toMatch(/SECRET/)
  })

  it('releases in-flight jobs on shutdown after the grace period, without counting the attempt', async () => {
    const w = await startWorker([defineJobHandler('curriculum.sync', () => new Promise(() => {}))])
    const { id } = await enqueue(db, { type: 'curriculum.sync', payload: {} })
    await until(async () => (await state(id)) === 'processing')
    await w.stop(50)
    worker = undefined
    expect(await getJob(db, id)).toMatchObject({ state: 'queued', attempts: 0, lockedBy: null })
  })

  it('schedules maintenance jobs once per interval', async () => {
    let runs = 0
    await startWorker([defineJobHandler('uploads.cleanup', async () => void runs++)], {
      schedules: [{ type: 'uploads.cleanup', everyMs: 3_600_000 }],
    })
    await until(() => runs === 1)
    const rows = await db.select().from(jobs)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.dedupeKey).toMatch(/^schedule:uploads\.cleanup:\d+$/)
  })
})

describe('worker health', () => {
  it('reports heartbeats and readiness', async () => {
    const [queue, wk] = jobsReadiness(db)
    expect(await queue!.check()).toEqual({ ok: true })
    expect((await wk!.check()).ok).toBe(false)
    expect(await checkWorkerHealth(db, { maxAgeSeconds: 60 })).toEqual({ ok: false, workers: 0 })
    const w = await startWorker([])
    expect(await checkWorkerHealth(db, { maxAgeSeconds: 60, workerIdPrefix: 'test-' })).toEqual({
      ok: true,
      workers: 1,
    })
    expect((await checkWorkerHealth(db, { maxAgeSeconds: 60, workerIdPrefix: 'other-' })).ok).toBe(false)
    expect(await wk!.check()).toEqual({ ok: true })
    await w.stop(10)
    worker = undefined
    expect((await checkWorkerHealth(db, { maxAgeSeconds: 60 })).ok).toBe(false)
  })
})
