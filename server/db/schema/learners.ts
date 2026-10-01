import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { learners } from './core'

// Learners domain: household settings (adult PIN), legacy import (docs/platform/learners.md).

/** Single row (id = 'household'). The adult PIN is only ever stored as a scrypt hash. */
export const householdSettings = pgTable('household_settings', {
  id: text('id').primaryKey().default('household'),
  adultPinHash: text('adult_pin_hash'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Lossless copy of an imported `localStorage['jackapp:v1']` payload (parentPin stripped). */
export const legacyProgress = pgTable(
  'legacy_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** sha256 of the received payload; makes re-imports idempotent. */
    payloadHash: text('payload_hash').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('legacy_progress_learner_hash_idx').on(t.learnerId, t.payloadHash)],
)

/** Per-skill progress from the legacy app, normalized. Raw source stays in legacy_progress. */
export const legacySkillProgress = pgTable(
  'legacy_skill_progress',
  {
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    /** Legacy SkillId, e.g. "math.add". */
    skill: text('skill').notNull(),
    importId: uuid('import_id')
      .notNull()
      .references(() => legacyProgress.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    attempts: integer('attempts').notNull(),
    firstTry: integer('first_try').notNull(),
    hintsUsed: integer('hints_used').notNull(),
    /** Outcomes, newest last: 'first' | 'retry' | 'helped'. */
    recent: jsonb('recent').$type<string[]>().notNull(),
    levelLocked: boolean('level_locked').notNull().default(false),
    lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.skill] }), index('legacy_skill_import_idx').on(t.importId)],
)
