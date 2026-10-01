import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { CurriculumRef } from '../../../shared/contracts'
import { learners } from './core'
import { legacyProgress } from './learners'
import { skillEvidence } from './shared'

// Adaptive domain: item kinds per evidence row, converted legacy skills, spaced reviews, learning paths.
// See docs/platform/adaptive.md.

/** Item kind of an evidence row (SkillEvidence has none); used by the recall-vs-explanation detector. */
export const skillEvidenceKinds = pgTable('skill_evidence_kinds', {
  evidenceId: uuid('evidence_id')
    .primaryKey()
    .references(() => skillEvidence.id, { onDelete: 'cascade' }),
  itemKind: text('item_kind').notNull(),
})

/** Legacy first-grade progress converted to the new skill tags; one row per legacy skill. */
export const adaptiveLegacySkills = pgTable(
  'adaptive_legacy_skills',
  {
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    legacySkill: text('legacy_skill').notNull(),
    skill: text('skill').notNull(),
    importId: uuid('import_id')
      .notNull()
      .references(() => legacyProgress.id, { onDelete: 'cascade' }),
    /** 'first' | 'retry' | 'helped', newest last. */
    outcomes: jsonb('outcomes').$type<string[]>().notNull(),
    attempts: integer('attempts').notNull(),
    lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.legacySkill] })],
)

/** Spaced review state per learner and leaf skill. `updatedAt` = newest answer already accounted for. */
export const skillReviews = pgTable(
  'skill_reviews',
  {
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    skill: text('skill').notNull(),
    /** Index into REVIEW_INTERVAL_DAYS. */
    step: integer('step').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.skill] })],
)

export interface StoredMilestone {
  id: string
  title: string
  skills: string[]
  status: 'upcoming' | 'active' | 'done'
  kind: 'goal' | 'remediation'
  curriculumRefs: CurriculumRef[]
  /** Optional planned date (YYYY-MM-DD). */
  by?: string
  activatedAt?: string
  /** artifact.generate job enqueued on activation; its resultId is the artifact. */
  jobId?: string
}

export const learningPaths = pgTable(
  'learning_paths',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    goal: text('goal').notNull(),
    subjectCode: text('subject_code'),
    targetDate: text('target_date'),
    studySetId: uuid('study_set_id'),
    status: text('status', { enum: ['active', 'paused', 'completed'] }).notNull(),
    milestones: jsonb('milestones').$type<StoredMilestone[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('learning_paths_learner_idx').on(t.learnerId)],
)
