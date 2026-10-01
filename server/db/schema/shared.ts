import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { AssetLicense } from '../../../shared/contracts'
import { learners } from './core'

// Tables shared by several domains (owned by the orchestrator).

/** Stored media: licensed external images, AI-generated images, project-owned art. Files live under DATA_DIR/assets. */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['image'] }).notNull(),
    mimeType: text('mime_type').notNull(),
    /** Path relative to DATA_DIR/assets. */
    path: text('path').notNull(),
    sha256: text('sha256').notNull(),
    bytes: integer('bytes').notNull(),
    alt: text('alt').notNull(),
    generated: boolean('generated').notNull(),
    license: jsonb('license').$type<AssetLicense>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('assets_sha_idx').on(t.sha256)],
)

/** One observed answer per skill tag (shared/contracts/learning.ts SkillEvidence). */
export const skillEvidence = pgTable(
  'skill_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    skill: text('skill').notNull(),
    subjectCode: text('subject_code'),
    artifactId: uuid('artifact_id'),
    itemId: text('item_id'),
    correct: boolean('correct').notNull(),
    misses: integer('misses').notNull(),
    hintsUsed: integer('hints_used').notNull(),
    difficulty: integer('difficulty').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('skill_evidence_learner_idx').on(t.learnerId, t.skill, t.at)],
)
