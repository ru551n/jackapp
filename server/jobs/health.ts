import { and, count, gt, like, max, sql } from 'drizzle-orm'
import type { ReadinessCheck } from '../app/context'
import type { Db } from '../db/client'
import { jobs, workerHeartbeats } from '../db/schema'

/** OK when at least one worker (optionally with id prefix, e.g. this container's hostname) beat recently. */
export async function checkWorkerHealth(db: Db, opts: { maxAgeSeconds: number; workerIdPrefix?: string }) {
  const [r] = await db
    .select({ workers: count(), lastBeat: max(workerHeartbeats.beatAt) })
    .from(workerHeartbeats)
    .where(
      and(
        gt(workerHeartbeats.beatAt, sql`now() - ${opts.maxAgeSeconds} * interval '1 second'`),
        opts.workerIdPrefix ? like(workerHeartbeats.workerId, `${opts.workerIdPrefix}%`) : undefined,
      ),
    )
  const workers = r?.workers ?? 0
  return { ok: workers > 0, workers }
}

/** App readiness: queue table reachable (critical), a worker beat recently (non-critical). */
export function jobsReadiness(db: Db, maxAgeSeconds = 60): ReadinessCheck[] {
  return [
    {
      name: 'jobs.queue',
      critical: true,
      check: async () => (await db.select({ id: jobs.id }).from(jobs).limit(1), { ok: true }),
    },
    {
      name: 'jobs.worker',
      critical: false,
      check: async () => {
        const h = await checkWorkerHealth(db, { maxAgeSeconds })
        return h.ok ? { ok: true } : { ok: false, detail: 'ingen aktiv arbetsprocess' }
      },
    },
  ]
}
