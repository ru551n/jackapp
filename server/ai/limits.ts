import { sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { aiRequestBuckets } from '../db/schema'
import { AiError } from './types'

// Global AI limits: per-process concurrency + requests/hour shared by app and worker via Postgres.

export class Semaphore {
  private active = 0
  private readonly waiters: (() => void)[] = []
  readonly max: number
  constructor(max: number) {
    this.max = max
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r))
    else this.active++
    try {
      return await fn()
    } finally {
      // Hand the slot directly to the next waiter (active stays the same) or free it.
      const next = this.waiters.shift()
      if (next) next()
      else this.active--
    }
  }
}

/** Count one request in the current hour (DB clock). Throws ai_rate_limited above `limit`. */
export async function countRequest(db: Db, limit: number): Promise<void> {
  // ponytail: old hourly rows are never pruned (~9k rows/year); add a cleanup job if it ever matters.
  const [row] = await db
    .insert(aiRequestBuckets)
    .values({ hour: sql`date_trunc('hour', now())`, count: 1 })
    .onConflictDoUpdate({ target: aiRequestBuckets.hour, set: { count: sql`${aiRequestBuckets.count} + 1` } })
    .returning({
      count: aiRequestBuckets.count,
      // Until the next hour bucket, on the DB clock.
      untilNextMs: sql<number>`ceil(extract(epoch from date_trunc('hour', now()) + interval '1 hour' - now()) * 1000)::int`,
    })
  if (row!.count > limit)
    throw new AiError('ai_rate_limited', {
      message: 'Gränsen för AI-anrop den här timmen är nådd. Försök igen senare.',
      detail: 'hourly limit (LIMIT_AI_REQUESTS_PER_HOUR)',
      retryAfterMs: Math.max(1000, Number(row!.untilNextMs)),
    })
}
