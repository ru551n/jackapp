import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { learners } from './core'

// Interactive runs of generated material (server/runs). Docs: docs/platform/runs.md

/** One learner session over one artifact version. `artifactId` has no FK: artifacts live in server/generation. */
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    artifactId: uuid('artifact_id').notNull(),
    artifactVersion: integer('artifact_version').notNull(),
    mode: text('mode', { enum: ['practice', 'test'] }).notNull(),
    feedback: text('feedback', { enum: ['immediate', 'end'] }).notNull(),
    state: text('state', { enum: ['active', 'finished', 'abandoned'] })
      .notNull()
      .default('active'),
    /** Hints shown so far per item id. */
    hintsShown: jsonb('hints_shown').$type<Record<string, number>>().notNull().default({}),
    /** RunSummary (server/runs/api.ts), set on finish. */
    summary: jsonb('summary').$type<unknown>(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('runs_learner_artifact_idx').on(t.learnerId, t.artifactId),
    /** At most one active run per learner and artifact: starting again resumes it. */
    uniqueIndex('runs_one_active_uq')
      .on(t.learnerId, t.artifactId)
      .where(sql`state = 'active'`),
  ],
)

/** One submitted attempt. `correct` null = free text awaiting self-assessment. */
export const runAnswers = pgTable(
  'run_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    attempt: integer('attempt').notNull(),
    answer: jsonb('answer').$type<unknown>().notNull(),
    correct: boolean('correct'),
    score: real('score'),
    hintsShown: integer('hints_shown').notNull().default(0),
    revealed: boolean('revealed').notNull().default(false),
    /** The item's outcome is settled (solved, revealed or rated); evidence was recorded. */
    final: boolean('final').notNull().default(false),
    /** Advisory model assessment (free text), never authoritative. */
    aiAssessed: boolean('ai_assessed').notNull().default(false),
    /** AnswerFeedback (server/runs/api.ts) as returned to the learner. */
    feedback: jsonb('feedback').$type<unknown>().notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('run_answers_attempt_uq').on(t.runId, t.itemId, t.attempt)],
)
