import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { JobError, JobState, JobType } from '../../../shared/contracts'
import { learners } from './core'

// Background job queue (server/jobs). See docs/platform/jobs.md.

const ts = (name: string) => timestamp(name, { withTimezone: true })

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').$type<JobType>().notNull(),
    state: text('state').$type<JobState>().notNull().default('queued'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    learnerId: uuid('learner_id').references(() => learners.id, { onDelete: 'cascade' }),
    /** Unique among active (queued/processing) jobs. */
    dedupeKey: text('dedupe_key'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: ts('run_after').notNull().defaultNow(),
    lastError: jsonb('last_error').$type<JobError>(),
    progress: real('progress').notNull().default(0),
    step: text('step'),
    resultId: text('result_id'),
    lockedBy: text('locked_by'),
    lockedAt: ts('locked_at'),
    heartbeatAt: ts('heartbeat_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('jobs_claim_idx').on(t.state, t.type, t.runAfter),
    index('jobs_learner_idx').on(t.learnerId, t.createdAt),
    index('jobs_finished_idx').on(t.finishedAt),
    uniqueIndex('jobs_dedupe_active_idx')
      .on(t.dedupeKey)
      .where(sql`state in ('queued', 'processing')`),
  ],
)

export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  startedAt: ts('started_at').notNull().defaultNow(),
  beatAt: ts('beat_at').notNull().defaultNow(),
  info: jsonb('info').$type<Record<string, unknown>>().notNull().default({}),
})
